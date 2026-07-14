import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";
import {
  baseEventFields,
  marketWhere,
  requireMarketUpdated,
  requireValue,
  type SettlementLog,
} from "src/indexer/handlers/settlement-shared";

export type MarketRefundsAvailableLog = SettlementLog<{
  marketId?: bigint;
  totalEscrowed?: bigint;
}>;

export type MarketCancelledLog = SettlementLog<{
  marketId?: bigint;
  totalEscrowed?: bigint;
}>;

export type MarketRefundsAvailableRecord =
  typeof schema.marketRefundsAvailableEvents.$inferInsert;
export type MarketCancelledRecord =
  typeof schema.marketCancelledEvents.$inferInsert;

export function buildMarketRefundsAvailableRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: MarketRefundsAvailableLog;
}): MarketRefundsAvailableRecord {
  return {
    ...baseEventFields({ blockTimestamp, config, contractId, log }),
    totalEscrowed: requireValue(log.args.totalEscrowed, "totalEscrowed"),
  };
}

export function buildMarketCancelledRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: MarketCancelledLog;
}): MarketCancelledRecord {
  return {
    ...baseEventFields({ blockTimestamp, config, contractId, log }),
    totalEscrowed: requireValue(log.args.totalEscrowed, "totalEscrowed"),
  };
}

export async function persistMarketRefundsAvailableRecord(
  record: MarketRefundsAvailableRecord,
  dbc: typeof db = db,
) {
  await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.marketRefundsAvailableEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.marketRefundsAvailableEvents.id });

    if (!inserted[0]) {
      return;
    }

    const updated = await tx
      .update(schema.markets)
      .set({
        status: "refunded",
        totalEscrowed: record.totalEscrowed,
        updatedAt: record.blockTimestamp,
      })
      .where(marketWhere(record))
      .returning({ id: schema.markets.id });

    requireMarketUpdated(updated, record);
  });
}

export async function persistMarketCancelledRecord(
  record: MarketCancelledRecord,
  dbc: typeof db = db,
) {
  await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.marketCancelledEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.marketCancelledEvents.id });

    if (!inserted[0]) {
      return;
    }

    const updated = await tx
      .update(schema.markets)
      .set({
        status: "cancelled",
        totalEscrowed: record.totalEscrowed,
        updatedAt: record.blockTimestamp,
      })
      .where(marketWhere(record))
      .returning({ id: schema.markets.id });

    requireMarketUpdated(updated, record);
  });
}
