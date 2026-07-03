import type {
  GraduationIneligibleReason,
  GraduationSummaryResponse,
  MarketResponse,
} from "src/api/models/markets";
import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

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
        "Onchain graduation is in progress. Wait for the clearing root challenge window to finish and for the graduation manager to finalize the market.",
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
      "Market is graduation-eligible, but settlement must happen onchain: start graduation, submit a clearing Merkle root, wait through the challenge window, then finalize with a postgrad adapter.",
    reason: "onchain_settlement_required",
  };
}

/**
 * Reports a market's graduation state and summary for the graduation endpoint.
 * Read-only by design — it validates identifiers, computes readiness, and
 * serializes the result, leaving all state changes to the on-chain flow.
 */
export async function requestMarketGraduation({
  chainId,
  marketId,
}: {
  chainId: number;
  marketId: string;
}): Promise<MarketGraduationResult> {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    return {
      kind: "invalid_market_id",
      message: "Invalid chain id.",
    };
  }

  let parsedMarketId: bigint;

  try {
    parsedMarketId = BigInt(marketId);
  } catch {
    return {
      kind: "invalid_market_id",
      message: "Invalid market id.",
    };
  }

  const row = await selectMarketForGraduation(chainId, parsedMarketId);

  if (!row) {
    return {
      kind: "not_found",
      message: "Market not found.",
    };
  }

  const matchedMarketCap = calculateMatchedMarketCap(row.market);
  const graduatedAt =
    row.market.status === "graduated" ? row.market.updatedAt : new Date();
  const summary = serializeGraduationSummary(
    buildGraduationSummary({
      graduatedAt,
      graduationThreshold: row.market.graduationThreshold,
      matchedMarketCap,
      receiptCount: row.market.receiptCount,
      totalEscrowed: row.market.totalEscrowed,
    }),
  );
  const readiness = evaluateGraduationReadiness({
    graduationThreshold: row.market.graduationThreshold,
    matchedMarketCap,
    status: row.market.status,
  });

  if (readiness.kind === "already_graduated") {
    return {
      kind: "graduated",
      market: serializeMarketRow(row.market, row.metadata, matchedMarketCap),
      summary,
    };
  }

  return {
    kind: "ineligible",
    market: serializeMarketRow(row.market, row.metadata, matchedMarketCap),
    message: readiness.message,
    reason: readiness.reason,
    summary,
  };
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
