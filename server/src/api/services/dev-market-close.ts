import { type Hash } from "viem";

import type {
  DevMarketCloseIneligibleReason,
  MarketResponse,
} from "src/api/models/markets";
import { config } from "src/config";
import { and, db, eq, schema } from "src/db/client";

import { markPregradMarketRefundableOnChain } from "./pregrad-refund";
import { calculateMatchedMarketCap } from "./matched-market-cap";
import { serializeMarketRow } from "./markets";

type MarketRow = typeof schema.markets.$inferSelect;
type MarketMetadataRow = typeof schema.marketMetadata.$inferSelect;
type DevMarketCloseRow = {
  market: MarketRow;
  metadata: MarketMetadataRow | null;
};

type ChainCloseResult =
  | {
      blockTimestamp: Date;
      kind: "already_refunded";
    }
  | {
      blockTimestamp: Date;
      kind: "closed";
      transactionHash: Hash;
    }
  | {
      kind: "wrong_status";
      status: number;
    };

/**
 * Discriminated outcome of a dev market close. Each variant maps to a distinct
 * HTTP response at the route layer; "closed" is idempotent and is also returned
 * when the market was already refunded.
 */
export type DevMarketCloseResult =
  | {
      kind: "closed";
      market: MarketResponse;
      refundAvailable: string;
      transactionHash?: Hash;
    }
  | {
      kind: "dev_disabled";
      message: string;
    }
  | {
      kind: "ineligible";
      market: MarketResponse;
      message: string;
      reason: DevMarketCloseIneligibleReason;
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
 * Injectable seams for closePregradMarketForRefund, so tests can cover the
 * eligibility and chain-status branches without a database or local RPC node.
 */
export type DevMarketCloseDependencies = {
  closeMarketOnChain: (marketId: bigint) => Promise<ChainCloseResult>;
  devCloseEnabled: () => boolean;
  markMarketRefunded: ({
    chainId,
    marketId,
    updatedAt,
  }: {
    chainId: number;
    marketId: bigint;
    updatedAt: Date;
  }) => Promise<MarketRow | null>;
  selectMarket: ({
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: bigint;
  }) => Promise<DevMarketCloseRow | null>;
};

/**
 * Dev-only escape hatch that force-closes a bootstrap market for refunds by
 * fast-forwarding the local chain past the graduation deadline and calling
 * markRefundable on-chain, then mirroring the refunded status into the
 * database. Refuses to run unless dev tools are enabled on the local network,
 * so it can never touch a live deployment.
 */
export async function closePregradMarketForRefund(
  {
    chainId,
    marketId,
  }: {
    chainId: number;
    marketId: string;
  },
  dependencies: DevMarketCloseDependencies = defaultDevMarketCloseDependencies,
): Promise<DevMarketCloseResult> {
  if (!dependencies.devCloseEnabled()) {
    return {
      kind: "dev_disabled",
      message: "Dev market close is disabled.",
    };
  }

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

  const row = await dependencies.selectMarket({
    chainId,
    marketId: parsedMarketId,
  });

  if (!row) {
    return {
      kind: "not_found",
      message: "Market not found.",
    };
  }

  const market = serializeCloseMarketRow(row);

  if (row.market.status === "refunded") {
    return {
      kind: "closed",
      market,
      refundAvailable: row.market.totalEscrowed.toString(),
    };
  }

  if (row.market.status !== "bootstrap") {
    return {
      kind: "ineligible",
      market,
      message: `Market is ${row.market.status}; only bootstrap markets can be closed for dev refunds.`,
      reason: "wrong_status",
    };
  }

  const chainResult = await dependencies.closeMarketOnChain(parsedMarketId);

  if (chainResult.kind === "wrong_status") {
    return {
      kind: "ineligible",
      market,
      message: `Market is not active on-chain; contract status is ${chainResult.status}.`,
      reason: "chain_status",
    };
  }

  const updatedMarket = await dependencies.markMarketRefunded({
    chainId,
    marketId: parsedMarketId,
    updatedAt: chainResult.blockTimestamp,
  });
  const serializedMarket = serializeCloseMarketRow({
    market: updatedMarket ?? {
      ...row.market,
      status: "refunded",
      updatedAt: chainResult.blockTimestamp,
    },
    metadata: row.metadata,
  });

  return {
    kind: "closed",
    market: serializedMarket,
    refundAvailable: serializedMarket.totalEscrowed,
    ...(chainResult.kind === "closed"
      ? { transactionHash: chainResult.transactionHash }
      : {}),
  };
}

function serializeCloseMarketRow(row: DevMarketCloseRow) {
  return serializeMarketRow(
    row.market,
    row.metadata,
    calculateMatchedMarketCap(row.market),
  );
}

const defaultDevMarketCloseDependencies: DevMarketCloseDependencies = {
  closeMarketOnChain: closeLocalMarketOnChain,
  devCloseEnabled: () => config.devToolsEnabled && config.name === "local",
  markMarketRefunded,
  selectMarket: selectMarketForDevClose,
};

async function selectMarketForDevClose({
  chainId,
  marketId,
}: {
  chainId: number;
  marketId: bigint;
}): Promise<DevMarketCloseRow | null> {
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

async function markMarketRefunded({
  chainId,
  marketId,
  updatedAt,
}: {
  chainId: number;
  marketId: bigint;
  updatedAt: Date;
}) {
  const [updatedMarket] = await db
    .update(schema.markets)
    .set({
      status: "refunded",
      updatedAt,
    })
    .where(
      and(
        eq(schema.markets.chainId, chainId),
        eq(schema.markets.marketId, marketId),
      ),
    )
    .returning();

  return updatedMarket ?? null;
}

/**
 * Fast-forwards the local chain to the market's graduation deadline and opens
 * refunds on-chain, reusing the shared markRefundable driver. The dev close
 * tool closes bootstrap markets before they reach their deadline, so it always
 * jumps the clock first; the projection mirror stays here in markMarketRefunded.
 */
async function closeLocalMarketOnChain(
  marketId: bigint,
): Promise<ChainCloseResult> {
  const result = await markPregradMarketRefundableOnChain(marketId, {
    fastForwardToDeadline: true,
  });

  if (result.kind === "already_refunded") {
    return {
      blockTimestamp: result.blockTimestamp,
      kind: "already_refunded",
    };
  }

  if (result.kind === "wrong_status") {
    return {
      kind: "wrong_status",
      status: result.status,
    };
  }

  return {
    blockTimestamp: result.blockTimestamp,
    kind: "closed",
    transactionHash: result.transactionHash,
  };
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
