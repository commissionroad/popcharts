import { and, db, desc, eq, schema } from "src/db/client";

/**
 * How long a market stays cooled down after any resolution job is created for
 * it, however that job was triggered. This is the endpoint's entire cost
 * control (repo ADR 0024): one requested AI evaluation per market per day
 * bounds worst-case spend at daily-poll cost, no matter how many people ask.
 */
export const RESOLUTION_REQUEST_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * How many attempts a publicly requested job gets. Mirrors the runner's own
 * enqueue default: the request only creates the job — the runner processes it
 * with the same retry/backoff machinery as automatic discovery.
 */
const REQUESTED_JOB_MAX_ATTEMPTS = 5;

type MarketRow = typeof schema.markets.$inferSelect;

/**
 * Discriminated outcome of a public resolution-check request. The endpoint
 * never resolves anything itself — "queued" means exactly one thing: a
 * resolution job now exists and the runner will evaluate the market on its
 * normal schedule.
 */
export type ResolutionRequestResult =
  | { kind: "invalid_market_id"; message: string }
  | { kind: "not_found"; message: string }
  | { kind: "not_eligible"; message: string; status: MarketRow["status"] }
  | { kind: "too_early"; earliestAt: Date; message: string }
  | { kind: "already_evaluated"; message: string }
  | { kind: "already_queued"; message: string }
  | { kind: "cooling_down"; message: string; nextEligibleAt: Date }
  | { kind: "queued"; message: string };

/**
 * Handles a permissionless "please look at this market" poke (repo ADR 0024
 * Phase 4) — the resolution sibling of the public graduation trigger. Safe
 * unauthenticated: the poke can only enqueue a resolution job the runner
 * would eventually create anyway, the resolver still decides the outcome,
 * and the dispute window still guards it on-chain. Requests are bounded by
 * the per-market cooldown rather than any caller identity.
 */
export async function requestMarketResolutionCheck(
  {
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: string;
  },
  { now = new Date() }: { now?: Date } = {},
): Promise<ResolutionRequestResult> {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return { kind: "invalid_market_id", message: "Invalid chain id." };
  }

  let parsedMarketId: bigint;
  try {
    parsedMarketId = BigInt(marketId);
  } catch {
    return { kind: "invalid_market_id", message: "Invalid market id." };
  }

  const [market] = await db
    .select()
    .from(schema.markets)
    .where(
      and(
        eq(schema.markets.chainId, chainId),
        eq(schema.markets.marketId, parsedMarketId),
      ),
    )
    .limit(1);

  if (!market) {
    return { kind: "not_found", message: "Market not found." };
  }

  if (market.status !== "graduated") {
    return {
      kind: "not_eligible",
      message:
        market.status === "resolved" || market.status === "cancelled"
          ? "Market is already settled."
          : "Market has not graduated; resolution applies to graduated markets only.",
      status: market.status,
    };
  }

  // The same earliest-resolution gate the runner's discovery query applies:
  // YES may be knowable from yesNotBefore, everything else from the
  // resolutionTime deadline.
  const earliestAt = market.yesNotBefore ?? market.resolutionTime;
  if (earliestAt.getTime() > now.getTime()) {
    return {
      earliestAt,
      kind: "too_early",
      message: "Market is not yet past its earliest resolution time.",
    };
  }

  const [resolution] = await db
    .select({ id: schema.marketResolutions.id })
    .from(schema.marketResolutions)
    .where(
      and(
        eq(schema.marketResolutions.chainId, chainId),
        eq(schema.marketResolutions.marketId, parsedMarketId),
      ),
    )
    .limit(1);

  if (resolution) {
    return {
      kind: "already_evaluated",
      message:
        "The resolver has already evaluated this market; its verdict is recorded or awaiting an operator.",
    };
  }

  const [latestJob] = await db
    .select({
      createdAt: schema.marketResolutionJobs.createdAt,
      status: schema.marketResolutionJobs.status,
    })
    .from(schema.marketResolutionJobs)
    .where(
      and(
        eq(schema.marketResolutionJobs.chainId, chainId),
        eq(schema.marketResolutionJobs.marketId, parsedMarketId),
      ),
    )
    .orderBy(desc(schema.marketResolutionJobs.createdAt))
    .limit(1);

  if (latestJob) {
    if (latestJob.status === "queued" || latestJob.status === "running") {
      return {
        kind: "already_queued",
        message: "A resolution check is already queued for this market.",
      };
    }

    const nextEligibleAt = new Date(
      latestJob.createdAt.getTime() + RESOLUTION_REQUEST_COOLDOWN_MS,
    );
    if (nextEligibleAt.getTime() > now.getTime()) {
      return {
        kind: "cooling_down",
        message:
          "This market was checked recently; it can be checked again after the cooldown.",
        nextEligibleAt,
      };
    }
  }

  await db
    .insert(schema.marketResolutionJobs)
    .values({
      attemptCount: 0,
      chainId,
      marketId: parsedMarketId,
      maxAttempts: REQUESTED_JOB_MAX_ATTEMPTS,
      metadataHash: market.metadataHash,
      notBefore: earliestAt,
      runAfter: now,
      trigger: "manual",
      updatedAt: now,
    })
    // The partial unique active-job index is the race guard when two requests
    // (or a request and the runner's own discovery) land simultaneously.
    .onConflictDoNothing();

  return {
    kind: "queued",
    message:
      "Resolution check queued; the resolver will evaluate this market shortly.",
  };
}
