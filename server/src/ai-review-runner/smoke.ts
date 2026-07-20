import { and, closeDb, db, desc, eq, schema } from "src/db/client";
import {
  claimReviewJobs,
  enqueueEligibleMarketReviewJobs,
  processReviewJob,
} from "./jobs";
import type { AiReviewRunnerConfig } from "./config";

const DEFAULT_SMOKE_PORT = "3012";
const SMOKE_JOB_PRIORITY = 2_147_483_647;

process.env.AI_REVIEW_PROVIDER ??= "heuristic";
process.env.AI_REVIEW_INTERNET_ACCESS ??= "off";
process.env.AI_REVIEW_FETCH_SEARCH_RESULTS ??= "false";
process.env.AI_REVIEW_PORT ??=
  process.env.AI_REVIEW_SMOKE_PORT ?? DEFAULT_SMOKE_PORT;

type AiReviewServerModule = typeof import("src/ai-review/server");

async function main() {
  let serverModule: AiReviewServerModule | null = null;
  let serviceStarted = false;

  try {
    const market = await adoptUnderReviewMarket();

    serverModule = await import("src/ai-review/server");
    const serviceUrl = startAiReviewService(serverModule);
    serviceStarted = true;

    const config = buildSmokeRunnerConfig(serviceUrl);

    const enqueued = await enqueueEligibleMarketReviewJobs({
      limit: 1,
      maxAttempts: config.maxAttempts,
      onlyMarket: {
        chainId: market.chainId,
        marketId: market.marketId,
        metadataHash: market.metadataHash,
      },
    });

    const smokeJob = enqueued.find(
      (job) =>
        job.chainId === market.chainId &&
        job.marketId === market.marketId &&
        job.metadataHash === market.metadataHash,
    );
    if (!smokeJob) {
      throw new Error(
        `Expected to enqueue the smoke market review job, enqueued ${enqueued.length}.`,
      );
    }

    await db
      .update(schema.marketAiReviewJobs)
      .set({
        priority: SMOKE_JOB_PRIORITY,
        requestedProvider: "heuristic",
        runAfter: new Date(0),
        updatedAt: new Date(),
      })
      .where(eq(schema.marketAiReviewJobs.id, smokeJob.id));

    const claimed = await claimReviewJobs({ config });
    const claimedJob = claimed[0];
    if (claimed.length !== 1 || !claimedJob) {
      throw new Error(
        `Expected to claim exactly one AI review job, claimed ${claimed.length}.`,
      );
    }
    if (claimedJob.job.id !== smokeJob.id) {
      throw new Error(
        `Expected to claim smoke job ${smokeJob.id}, claimed ${claimedJob.job.id}.`,
      );
    }

    const outcome = await processReviewJob({
      claimed: claimedJob,
      config,
    });
    if (outcome.status !== "succeeded") {
      throw new Error(`AI review smoke job ${outcome.status}.`);
    }
    if (outcome.review.verdict !== "approve") {
      throw new Error(
        `Expected heuristic smoke review to approve, got ${outcome.review.verdict}.`,
      );
    }

    const [updatedMarket] = await db
      .select()
      .from(schema.markets)
      .where(
        and(
          eq(schema.markets.chainId, market.chainId),
          eq(schema.markets.marketId, market.marketId),
        ),
      )
      .limit(1);

    if (updatedMarket?.status !== "bootstrap") {
      throw new Error(
        `Expected reviewed smoke market to transition to bootstrap, got ${updatedMarket?.status ?? "missing"}.`,
      );
    }

    console.info("[AI Review Runner Smoke] passed", {
      enqueuedJobs: enqueued.length,
      jobId: outcome.job.id,
      marketId: market.marketId.toString(),
      metadataHash: market.metadataHash,
      reviewId: outcome.review.id,
      status: updatedMarket?.status,
      verdict: outcome.review.verdict,
    });
  } finally {
    if (serviceStarted) {
      await serverModule?.aiReviewApp.stop();
    }
    await closeDb();
  }
}

function startAiReviewService({
  aiReviewApp,
  buildAiReviewRuntimeStatus,
}: AiReviewServerModule) {
  const runtimeStatus = buildAiReviewRuntimeStatus();
  if (!runtimeStatus.ready) {
    throw new Error(
      `AI Review service provider ${runtimeStatus.activeProvider} is not ready.`,
    );
  }

  const configuredPort = Number.parseInt(
    process.env.AI_REVIEW_PORT ?? DEFAULT_SMOKE_PORT,
    10,
  );
  aiReviewApp.listen(configuredPort);
  const port = aiReviewApp.server?.port ?? configuredPort;
  const serviceUrl = `http://127.0.0.1:${port}`;

  console.info("[AI Review Runner Smoke] review service started", {
    provider: runtimeStatus.activeProvider,
    serviceUrl,
  });

  return serviceUrl;
}

function buildSmokeRunnerConfig(serviceUrl: string): AiReviewRunnerConfig {
  return {
    backoffMs: 1_000,
    batchSize: 1,
    leaseMs: 30_000,
    maxAttempts: 2,
    pollMs: 500,
    requestTimeoutMs: 8_000,
    runnerId: `ai-review-smoke-${process.pid}`,
    serviceUrl,
  };
}

async function adoptUnderReviewMarket() {
  // The smoke reviews a real market — the review runner submits a real
  // approveMarket transaction, so a fabricated row would revert with
  // MarketDoesNotExist (the failure mode this smoke had until ADR 0017 C2).
  // scripts/local-ai-review-smoke.ts creates a fresh market and pins it via
  // env; without the pin, the newest indexed under_review market is adopted.
  await sweepLegacyFabricatedRows();

  const pinnedMarketId = process.env.POPCHARTS_SMOKE_MARKET_ID;
  const deadline = Date.now() + 60_000;
  for (;;) {
    const [row] = await db
      .select()
      .from(schema.markets)
      .innerJoin(
        schema.marketMetadata,
        and(
          eq(schema.marketMetadata.chainId, schema.markets.chainId),
          eq(schema.marketMetadata.metadataHash, schema.markets.metadataHash),
        ),
      )
      .where(
        pinnedMarketId
          ? and(
              eq(schema.markets.status, "under_review"),
              eq(schema.markets.marketId, BigInt(pinnedMarketId)),
            )
          : eq(schema.markets.status, "under_review"),
      )
      .orderBy(desc(schema.markets.createdAt))
      .limit(1);

    if (row) {
      return row.markets;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        [
          pinnedMarketId
            ? `Market ${pinnedMarketId} did not appear as under_review within 60s.`
            : "No under_review market with metadata found within 60s.",
          "This smoke requires the live local stack. Run",
          "`pnpm local:smoke -- --keep-running`, then",
          "`pnpm local:ai-review-smoke` (it creates and pins a fresh market).",
        ].join(" "),
      );
    }
    await new Promise((resolvePoll) => setTimeout(resolvePoll, 2_000));
  }
}

/**
 * Earlier versions of this smoke fabricated markets in the database (fake
 * contract 0x...cafe, creator 0x...01). Long-lived local databases still
 * carry those rows, and their jobs shadow real ones — delete them.
 */
async function sweepLegacyFabricatedRows() {
  const LEGACY_CREATOR = "0x0000000000000000000000000000000000000001";
  const rows = await db
    .select({
      chainId: schema.markets.chainId,
      marketId: schema.markets.marketId,
      metadataHash: schema.markets.metadataHash,
    })
    .from(schema.markets)
    .where(eq(schema.markets.creator, LEGACY_CREATOR));

  for (const row of rows) {
    await db
      .delete(schema.marketAiReviewJobs)
      .where(
        and(
          eq(schema.marketAiReviewJobs.chainId, row.chainId),
          eq(schema.marketAiReviewJobs.marketId, row.marketId),
          eq(schema.marketAiReviewJobs.metadataHash, row.metadataHash),
        ),
      );
    await db
      .delete(schema.marketAiReviews)
      .where(
        and(
          eq(schema.marketAiReviews.chainId, row.chainId),
          eq(schema.marketAiReviews.marketId, row.marketId),
          eq(schema.marketAiReviews.metadataHash, row.metadataHash),
        ),
      );
    await db
      .delete(schema.markets)
      .where(
        and(
          eq(schema.markets.chainId, row.chainId),
          eq(schema.markets.marketId, row.marketId),
        ),
      );
    await db
      .delete(schema.marketMetadata)
      .where(
        and(
          eq(schema.marketMetadata.chainId, row.chainId),
          eq(schema.marketMetadata.metadataHash, row.metadataHash),
        ),
      );
    console.info("[AI Review Runner Smoke] swept legacy fabricated market", {
      marketId: row.marketId.toString(),
    });
  }
}

if (import.meta.main) {
  main().catch((error) => {
    if (looksLikeConnectionRefused(error)) {
      console.error(
        [
          "[AI Review Runner Smoke] failed: local Postgres is not reachable.",
          "Start the local database on the configured DATABASE_URL, then rerun the smoke command.",
          "The default server DATABASE_URL expects PostgreSQL at localhost:5433.",
        ].join("\n"),
      );
    } else {
      console.error("[AI Review Runner Smoke] failed", error);
    }

    process.exitCode = 1;
  });
}

function looksLikeConnectionRefused(error: unknown) {
  if (typeof error === "object" && error !== null) {
    if ((error as { code?: unknown }).code === "ECONNREFUSED") {
      return true;
    }

    const nested = (error as { errors?: unknown }).errors;
    if (Array.isArray(nested) && nested.some(looksLikeConnectionRefused)) {
      return true;
    }
  }

  const message =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error);
  return message.includes("ECONNREFUSED");
}
