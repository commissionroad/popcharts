import type {
  GraduationIneligibleReason,
  GraduationSummaryResponse,
  MarketResponse,
} from "src/api/models/markets";
import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { getMatchedMarketCap } from "./matched-market-cap-read";
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

  const matchedMarketCap = await getMatchedMarketCap(row.market);
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

  if (row.market.status === "graduated") {
    return {
      kind: "graduated",
      market: serializeMarketRow(row.market, row.metadata, matchedMarketCap),
      summary,
    };
  }

  if (row.market.status !== "bootstrap") {
    return {
      kind: "ineligible",
      market: serializeMarketRow(row.market, row.metadata, matchedMarketCap),
      message: `Market is ${row.market.status}; only bootstrap markets can graduate in this first pass.`,
      reason: "wrong_status",
      summary,
    };
  }

  if (matchedMarketCap < row.market.graduationThreshold) {
    return {
      kind: "ineligible",
      market: serializeMarketRow(row.market, row.metadata, matchedMarketCap),
      message: "Matched liquidity is below this market's graduation threshold.",
      reason: "below_threshold",
      summary,
    };
  }

  const [updatedMarket] = await db
    .update(schema.markets)
    .set({
      status: "graduated",
      updatedAt: graduatedAt,
    })
    .where(
      and(
        eq(schema.markets.chainId, chainId),
        eq(schema.markets.marketId, parsedMarketId),
        eq(schema.markets.status, "bootstrap"),
      ),
    )
    .returning();

  return {
    kind: "graduated",
    market: serializeMarketRow(
      updatedMarket ?? {
        ...row.market,
        status: "graduated",
        updatedAt: graduatedAt,
      },
      row.metadata,
      matchedMarketCap,
    ),
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
