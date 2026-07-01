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
