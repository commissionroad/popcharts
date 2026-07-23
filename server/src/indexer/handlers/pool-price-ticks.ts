import type { Log } from "viem";

import { recordLiveChange } from "src/change-feed/writer";
import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";
import { findVenuePoolMarketId } from "src/indexer/handlers/venue-pools";

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
 *
 * A fresh tick signals the market's live channel (repo ADR 0021) — a taker
 * swap moves the order book's pool prices — atomic with the insert. The
 * market route is the only one a tick has, so when the pool maps to no
 * indexed market (best-effort mapping, see ensureVenuePoolIndexed) nothing is
 * recorded rather than an unroutable row.
 */
export async function persistPoolPriceTickRecord(
  record: PoolPriceTickRecord,
  dbc: typeof db = db,
) {
  await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.poolPriceTicks)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.poolPriceTicks.id });

    if (!inserted[0]) {
      return;
    }

    const marketId = await findVenuePoolMarketId(tx, {
      chainId: record.chainId,
      poolId: record.poolId,
    });

    if (marketId === null) {
      return;
    }

    await recordLiveChange(tx, {
      sourceTable: "pool_price_ticks",
      op: "insert",
      chainId: record.chainId,
      marketId,
      rowId: inserted[0].id,
      blockNumber: record.blockNumber,
      logIndex: record.logIndex,
    });
  });
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Pool price tick log is missing ${name}.`);
  }

  return value;
}
