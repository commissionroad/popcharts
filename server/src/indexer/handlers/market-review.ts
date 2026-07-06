import type { Log } from "viem";

import type { MarketStatus } from "src/api/models/markets";
import type { NetworkConfig } from "src/config";
import { and, db, eq, schema } from "src/db/client";
import { MarketNotIndexedError } from "src/indexer/handlers/market-projection";

export type MarketReviewLog = Log & {
  args: {
    marketId?: bigint;
    reviewer?: `0x${string}`;
  };
};

export type MarketReviewStatus = Extract<
  MarketStatus,
  "bootstrap" | "rejected"
>;

export type MarketReviewStatusUpdate = {
  chainId: number;
  marketId: bigint;
  status: MarketReviewStatus;
  updatedAt: Date;
};

export function buildMarketReviewStatusUpdate({
  blockTimestamp,
  config,
  log,
  status,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  log: MarketReviewLog;
  status: MarketReviewStatus;
}): MarketReviewStatusUpdate {
  return {
    chainId: config.chainId,
    marketId: requireValue(log.args.marketId, "marketId"),
    status,
    updatedAt: blockTimestamp,
  };
}

export async function persistMarketReviewStatusUpdate(
  update: MarketReviewStatusUpdate,
  dbc: typeof db = db,
) {
  const updated = await dbc
    .update(schema.markets)
    .set({
      status: update.status,
      updatedAt: update.updatedAt,
    })
    .where(
      and(
        eq(schema.markets.chainId, update.chainId),
        eq(schema.markets.marketId, update.marketId),
        // Review events only ever move a market out of under_review, so a
        // replayed event can never stomp a later graduation or settlement
        // status back to bootstrap/rejected.
        eq(schema.markets.status, "under_review"),
      ),
    )
    .returning({ id: schema.markets.id });

  if (updated.length > 0) {
    return;
  }

  // Zero matched rows is ambiguous: the market may already be past review (an
  // idempotent replay), or MarketCreated may not be persisted yet — dropping
  // the update then would lose the status change forever, because the block
  // cursor advances past this event. Only the missing row is an error.
  const market = await dbc.query.markets.findFirst({
    columns: { id: true },
    where: and(
      eq(schema.markets.chainId, update.chainId),
      eq(schema.markets.marketId, update.marketId),
    ),
  });

  if (!market) {
    throw new MarketNotIndexedError(update);
  }
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Market review log is missing ${name}.`);
  }

  return value;
}
