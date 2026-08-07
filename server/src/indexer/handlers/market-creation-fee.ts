import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";
import { requireMarketRowIndexed } from "src/indexer/handlers/market-projection";
import { logValueRequirer } from "src/indexer/utils/log-values";

const requireValue = logValueRequirer("Market creation fee log");

export type MarketCreationFeePaidLog = Log & {
  args: {
    marketId?: bigint;
    creator?: string;
    amount?: bigint;
  };
};

export type MarketCreationFeeRecord = {
  event: typeof schema.marketCreationFeeEvents.$inferInsert;
};

/**
 * Maps a MarketCreationFeePaid log into a raw event row — the money paper
 * trail for the market creation fee (ADR 0022,
 * docs/portfolio-data-design.md). The fee moves inside `createMarket`, so the
 * log is the only evidence it was paid; nothing here is derived from the
 * market row or from the configured fee constant.
 */
export function buildMarketCreationFeeRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: MarketCreationFeePaidLog;
}): MarketCreationFeeRecord {
  return {
    event: {
      amount: requireValue(log.args.amount, "amount"),
      blockNumber: requireValue(log.blockNumber, "blockNumber"),
      blockTimestamp,
      chainId: config.chainId,
      contractId,
      creator: requireValue(log.args.creator, "creator").toLowerCase(),
      logIndex: requireValue(log.logIndex, "logIndex"),
      marketId: requireValue(log.args.marketId, "marketId"),
      transactionHash: requireValue(log.transactionHash, "transactionHash"),
    },
  };
}

/**
 * Persists the raw fee-payment row. Append-only and deduped on
 * (chain, tx, log): there is no projection to update — the fee is a one-shot
 * payment with no running balance — so a replay can never double-count it.
 * Deliberately no change-feed signal: market_creation_fee_events is not a
 * registered live-update source, and registering a route belongs to whichever
 * build adds a surface that reads it.
 *
 * The row is foreign-keyed to `markets`, and `MarketCreationFeePaid` shares a
 * transaction with `MarketCreated` but is consumed by a separate watcher, so
 * on the live path this can run before the market row exists. The explicit
 * check exists to make that case a **parkable** `MarketNotIndexedError` rather
 * than a raw foreign-key violation: an unrecognized error propagates out of
 * the per-log boundary and abandons the whole sweep pass, while a
 * ParkSweepError parks this address below the log so the next sweep retries
 * it. The foreign key still backstops the check — a market row deleted
 * between the select and the insert raises the constraint, which is the
 * correct hard failure.
 */
export async function persistMarketCreationFeeRecord(
  record: MarketCreationFeeRecord,
  dbc: typeof db = db,
) {
  await requireMarketRowIndexed(
    record.event.chainId,
    record.event.marketId,
    dbc,
  );

  await dbc
    .insert(schema.marketCreationFeeEvents)
    .values(record.event)
    .onConflictDoNothing();
}
