import type {
  GraduationIneligibleReason,
  GraduationSummaryResponse,
  MarketResponse,
} from "src/api/models/markets";
import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import type { ChainGraduationResult } from "./dev-market-graduate";
import { calculateMatchedMarketCap } from "./matched-market-cap";
import { serializeMarketRow } from "./markets";

type MarketRow = typeof schema.markets.$inferSelect;
type MarketMetadataRow = typeof schema.marketMetadata.$inferSelect;

type GraduationSummary = {
  completeSetCount: bigint;
  graduatedAt: Date;
  graduationThreshold: bigint;
  matchedMarketCap: bigint;
  noTokens: bigint;
  receiptCount: bigint;
  refundedCollateral: bigint;
  totalEscrowed: bigint;
  yesTokens: bigint;
};

type GraduationMarketRow = {
  market: MarketRow;
  metadata: MarketMetadataRow | null;
};

type GraduationReadiness =
  | {
      kind: "already_graduated";
    }
  | {
      kind: "ineligible";
      message: string;
      reason: GraduationIneligibleReason;
    };

/**
 * Discriminated outcome of a graduation request. Because settlement is
 * on-chain, the API never performs graduation itself: "graduated" only reports
 * a market the chain already finalized, and every other variant explains why
 * the request cannot proceed.
 */
export type MarketGraduationResult =
  | {
      kind: "graduated";
      market: MarketResponse;
      summary: GraduationSummaryResponse;
    }
  | {
      kind: "ineligible";
      market: MarketResponse;
      message: string;
      reason: GraduationIneligibleReason;
      summary: GraduationSummaryResponse;
    }
  | {
      kind: "invalid_market_id";
      message: string;
    }
  | {
      kind: "not_found";
      message: string;
    };

/**
 * Derives the graduation accounting from matched market cap: each matched
 * complete set mints one YES and one NO token, and any escrow above the
 * matched cap is returned to bettors as refunded collateral.
 */
export function buildGraduationSummary({
  graduatedAt = new Date(),
  graduationThreshold,
  matchedMarketCap,
  receiptCount,
  totalEscrowed,
}: {
  graduatedAt?: Date;
  graduationThreshold: bigint;
  matchedMarketCap: bigint;
  receiptCount: bigint;
  totalEscrowed: bigint;
}): GraduationSummary {
  const refundedCollateral =
    totalEscrowed > matchedMarketCap ? totalEscrowed - matchedMarketCap : 0n;

  return {
    completeSetCount: matchedMarketCap,
    graduatedAt,
    graduationThreshold,
    matchedMarketCap,
    noTokens: matchedMarketCap,
    receiptCount,
    refundedCollateral,
    totalEscrowed,
    yesTokens: matchedMarketCap,
  };
}

/**
 * Converts a graduation summary to its API shape: bigints become decimal
 * strings and the timestamp becomes an ISO string, so JSON serialization never
 * loses uint256 precision.
 */
export function serializeGraduationSummary({
  completeSetCount,
  graduatedAt,
  graduationThreshold,
  matchedMarketCap,
  noTokens,
  receiptCount,
  refundedCollateral,
  totalEscrowed,
  yesTokens,
}: GraduationSummary): GraduationSummaryResponse {
  return {
    completeSetCount: completeSetCount.toString(),
    graduatedAt: graduatedAt.toISOString(),
    graduationThreshold: graduationThreshold.toString(),
    matchedMarketCap: matchedMarketCap.toString(),
    noTokens: noTokens.toString(),
    receiptCount: receiptCount.toString(),
    refundedCollateral: refundedCollateral.toString(),
    totalEscrowed: totalEscrowed.toString(),
    yesTokens: yesTokens.toString(),
  };
}

/**
 * Classifies how close a market is to graduating. Never returns an "eligible"
 * outcome: even a market above its threshold reports
 * onchain_settlement_required, because graduation must be finalized through
 * the on-chain challenge-window flow, not by this API.
 */
export function evaluateGraduationReadiness({
  graduationThreshold,
  matchedMarketCap,
  status,
}: {
  graduationThreshold: bigint;
  matchedMarketCap: bigint;
  status: MarketRow["status"];
}): GraduationReadiness {
  if (status === "graduated") {
    return { kind: "already_graduated" };
  }

  if (status === "graduating") {
    return {
      kind: "ineligible",
      message:
        "Onchain graduation is in progress. Wait for the graduation manager to finalize the market's clearing root.",
      reason: "clearing_pending",
    };
  }

  if (status !== "bootstrap") {
    return {
      kind: "ineligible",
      message: `Market is ${status}; only bootstrap markets can enter onchain graduation.`,
      reason: "wrong_status",
    };
  }

  if (matchedMarketCap < graduationThreshold) {
    return {
      kind: "ineligible",
      message: "Matched liquidity is below this market's graduation threshold.",
      reason: "below_threshold",
    };
  }

  return {
    kind: "ineligible",
    message:
      "Market is graduation-eligible, but settlement must happen onchain: start graduation, submit a clearing Merkle root, then finalize with a postgrad adapter.",
    reason: "onchain_settlement_required",
  };
}

/** Injectable seams: the on-chain settlement, and the market lookup for tests. */
export type RequestMarketGraduationDependencies = {
  selectMarket?: (
    chainId: number,
    marketId: bigint,
  ) => Promise<GraduationMarketRow | null>;
  settleGraduationOnChain: (
    marketId: bigint,
    force: boolean,
  ) => Promise<ChainGraduationResult>;
};

/**
 * The public graduation failsafe. For a market that looks eligible it runs the
 * server's manager-keyed on-chain settlement (band-pass clearing, never a
 * liquidity top-up), so anyone can kick off a graduation the keeper missed.
 * Safe to expose unauthenticated: the settlement re-checks band-pass eligibility
 * from real receipts before `startGraduation` and relies on the contract's
 * conservation checks; a below-threshold or wrong-status market is reported, not
 * touched. `startGraduation` itself is manager-only, so the caller can only ask
 * — the server performs the privileged steps with its own key.
 */
export async function requestMarketGraduation(
  { chainId, marketId }: { chainId: number; marketId: string },
  {
    selectMarket = selectMarketForGraduation,
    settleGraduationOnChain,
  }: RequestMarketGraduationDependencies,
): Promise<MarketGraduationResult> {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return { kind: "invalid_market_id", message: "Invalid chain id." };
  }

  let parsedMarketId: bigint;

  try {
    parsedMarketId = BigInt(marketId);
  } catch {
    return { kind: "invalid_market_id", message: "Invalid market id." };
  }

  const row = await selectMarket(chainId, parsedMarketId);

  if (!row) {
    return { kind: "not_found", message: "Market not found." };
  }

  const matchedMarketCap = calculateMatchedMarketCap(row.market);
  const readiness = evaluateGraduationReadiness({
    graduationThreshold: row.market.graduationThreshold,
    matchedMarketCap,
    status: row.market.status,
  });

  if (readiness.kind === "already_graduated") {
    return graduatedResult(row, matchedMarketCap);
  }

  // Only "looks eligible" or mid-graduation markets are worth a chain round
  // trip. The display cap over-counts matched liquidity (it is min(totalYes,
  // totalNo), an upper bound on the true band-pass cap), so a cap below
  // threshold is authoritatively below threshold — report it without touching
  // the chain.
  const shouldSettle =
    readiness.reason === "onchain_settlement_required" ||
    readiness.reason === "clearing_pending";

  if (!shouldSettle) {
    return ineligibleResult(
      row,
      matchedMarketCap,
      readiness.message,
      readiness.reason,
    );
  }

  const outcome = await settleGraduationOnChain(parsedMarketId, false);
  return mapChainOutcome({
    chainId,
    displayMatchedCap: matchedMarketCap,
    marketId: parsedMarketId,
    outcome,
    row,
    selectMarket,
  });
}

/** Maps the on-chain settlement outcome onto the API's graduation result. */
async function mapChainOutcome({
  chainId,
  displayMatchedCap,
  marketId,
  outcome,
  row,
  selectMarket,
}: {
  chainId: number;
  displayMatchedCap: bigint;
  marketId: bigint;
  outcome: ChainGraduationResult;
  row: GraduationMarketRow;
  selectMarket: (
    chainId: number,
    marketId: bigint,
  ) => Promise<GraduationMarketRow | null>;
}): Promise<MarketGraduationResult> {
  switch (outcome.kind) {
    case "graduated": {
      const fresh = (await selectMarket(chainId, marketId)) ?? row;
      return graduatedResult(fresh, outcome.finalized.matchedMarketCap);
    }
    case "already_graduated": {
      const fresh = (await selectMarket(chainId, marketId)) ?? row;
      return graduatedResult(fresh, calculateMatchedMarketCap(fresh.market));
    }
    case "below_threshold":
      return ineligibleResult(
        row,
        outcome.matchedMarketCap,
        "Matched liquidity is below this market's graduation threshold.",
        "below_threshold",
      );
    case "past_deadline":
      return ineligibleResult(
        row,
        displayMatchedCap,
        "Market passed its graduation deadline and can only be refunded.",
        "wrong_status",
      );
    case "wrong_status":
      return ineligibleResult(
        row,
        displayMatchedCap,
        "Market is not in a graduatable state for onchain settlement.",
        "wrong_status",
      );
  }
}

function graduatedResult(
  row: GraduationMarketRow,
  matchedMarketCap: bigint,
): MarketGraduationResult {
  const graduatedAt =
    row.market.status === "graduated" ? row.market.updatedAt : new Date();
  return {
    kind: "graduated",
    market: serializeMarketRow(row.market, row.metadata, matchedMarketCap),
    summary: graduationSummaryFor(row, matchedMarketCap, graduatedAt),
  };
}

function ineligibleResult(
  row: GraduationMarketRow,
  matchedMarketCap: bigint,
  message: string,
  reason: GraduationIneligibleReason,
): MarketGraduationResult {
  return {
    kind: "ineligible",
    market: serializeMarketRow(row.market, row.metadata, matchedMarketCap),
    message,
    reason,
    summary: graduationSummaryFor(row, matchedMarketCap, new Date()),
  };
}

function graduationSummaryFor(
  row: GraduationMarketRow,
  matchedMarketCap: bigint,
  graduatedAt: Date,
): GraduationSummaryResponse {
  return serializeGraduationSummary(
    buildGraduationSummary({
      graduatedAt,
      graduationThreshold: row.market.graduationThreshold,
      matchedMarketCap,
      receiptCount: row.market.receiptCount,
      totalEscrowed: row.market.totalEscrowed,
    }),
  );
}

async function selectMarketForGraduation(
  chainId: number,
  marketId: bigint,
): Promise<GraduationMarketRow | null> {
  const rows = await db
    .select({
      market: schema.markets,
      metadata: schema.marketMetadata,
    })
    .from(schema.markets)
    .innerJoin(schema.contracts, marketContractJoinCondition())
    .leftJoin(schema.marketMetadata, marketMetadataJoinCondition())
    .where(
      and(
        eq(
          schema.contracts.address,
          config.contracts.pregradManager.toLowerCase(),
        ),
        eq(schema.contracts.chainId, config.chainId),
        eq(schema.markets.chainId, chainId),
        eq(schema.markets.marketId, marketId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

function marketMetadataJoinCondition() {
  return and(
    eq(schema.marketMetadata.chainId, schema.markets.chainId),
    eq(schema.marketMetadata.metadataHash, schema.markets.metadataHash),
  );
}

function marketContractJoinCondition() {
  return and(
    eq(schema.contracts.id, schema.markets.contractId),
    eq(schema.contracts.chainId, schema.markets.chainId),
  );
}
