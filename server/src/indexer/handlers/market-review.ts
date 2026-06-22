import type { Log } from "viem";

import type { MarketStatus } from "src/api/models/markets";
import type { NetworkConfig } from "src/config";
import { and, db, eq, schema } from "src/db/client";

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
) {
  await db
    .update(schema.markets)
    .set({
      status: update.status,
      updatedAt: update.updatedAt,
    })
    .where(
      and(
        eq(schema.markets.chainId, update.chainId),
        eq(schema.markets.marketId, update.marketId),
      ),
    );
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Market review log is missing ${name}.`);
  }

  return value;
}
