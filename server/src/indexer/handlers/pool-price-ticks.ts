import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";

export type PoolPriceTickLog = Log & {
  args: {
    poolId?: `0x${string}`;
    tick?: number;
  };
};

export type PoolPriceTickRecord = typeof schema.poolPriceTicks.$inferInsert;

type BuildInput = {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: PoolPriceTickLog;
};

/**
 * Maps an AfterSwapTickObserved log from the BoundedPredictionHook into a
 * typed pool_price_ticks row. Only the raw tick is recorded; price
 * derivation lives in the API/app layer.
 */
export function buildPoolPriceTickRecord(
  input: BuildInput,
): PoolPriceTickRecord {
  const { blockTimestamp, config, contractId, log } = input;

  return {
    blockNumber: requireValue(log.blockNumber, "blockNumber"),
    blockTimestamp,
    chainId: config.chainId,
    contractId,
    logIndex: requireValue(log.logIndex, "logIndex"),
    poolId: requireValue(log.args.poolId, "poolId").toLowerCase(),
    tick: requireValue(log.args.tick, "tick"),
    transactionHash: requireValue(log.transactionHash, "transactionHash"),
  };
}

/**
 * Persists the raw tick observation. Append-only: there is no projection to
 * update. The insert dedupes on (chain, tx, log) so a recovery replay or
 * double live delivery never double-records a swap tick.
 */
export async function persistPoolPriceTickRecord(
  record: PoolPriceTickRecord,
  dbc: typeof db = db,
) {
  await dbc.insert(schema.poolPriceTicks).values(record).onConflictDoNothing();
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Pool price tick log is missing ${name}.`);
  }

  return value;
}
