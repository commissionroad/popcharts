import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { and, eq, schema } from "src/db/client";
import { MarketNotIndexedError } from "src/indexer/handlers/market-projection";

export type BaseSettlementArgs = {
  marketId?: bigint;
};

export type SettlementLog<TArgs extends BaseSettlementArgs> = Log & {
  args: TArgs;
};

export function baseEventFields<TArgs extends BaseSettlementArgs>({
  blockTimestamp,
  config,
  contractId,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: SettlementLog<TArgs>;
}) {
  return {
    blockNumber: requireValue(log.blockNumber, "blockNumber"),
    blockTimestamp,
    chainId: config.chainId,
    contractId,
    logIndex: requireValue(log.logIndex, "logIndex"),
    marketId: requireValue(log.args.marketId, "marketId"),
    transactionHash: requireValue(log.transactionHash, "transactionHash"),
  };
}

/**
 * Throwing here rolls back the event insert in the surrounding transaction.
 * Committing the event row without its markets projection would make the
 * onConflictDoNothing dedup skip the projection on every future replay,
 * losing the update forever once the block cursor advances.
 */
export function requireMarketUpdated(
  updated: Array<{ id: number }>,
  record: { chainId: number; marketId: bigint },
) {
  if (!updated[0]) {
    throw new MarketNotIndexedError(record);
  }
}

export function marketWhere(record: { chainId: number; marketId: bigint }) {
  return and(
    eq(schema.markets.chainId, record.chainId),
    eq(schema.markets.marketId, record.marketId),
  );
}

export function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Settlement log is missing ${name}.`);
  }

  return value;
}

export function unixSecondsToDate(value: bigint) {
  return new Date(Number(value) * 1000);
}
