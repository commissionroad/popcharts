import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { and, db, eq, schema, sql } from "src/db/client";
import { MarketNotIndexedError } from "src/indexer/handlers/market-projection";

export type ReceiptPlacedLog = Log & {
  args: {
    cost?: bigint;
    marketId?: bigint;
    owner?: `0x${string}`;
    rHigh?: bigint;
    rLow?: bigint;
    receiptId?: bigint;
    sequence?: bigint;
    shares?: bigint;
    side?: number;
  };
};

export type ReceiptPlacedRecord =
  typeof schema.receiptPlacedEvents.$inferInsert;

export function buildReceiptPlacedRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: ReceiptPlacedLog;
}): ReceiptPlacedRecord {
  return {
    blockNumber: requireValue(log.blockNumber, "blockNumber"),
    blockTimestamp,
    chainId: config.chainId,
    contractId,
    cost: requireValue(log.args.cost, "cost"),
    logIndex: requireValue(log.logIndex, "logIndex"),
    marketId: requireValue(log.args.marketId, "marketId"),
    owner: requireValue(log.args.owner, "owner").toLowerCase(),
    rHigh: requireValue(log.args.rHigh, "rHigh").toString(),
    rLow: requireValue(log.args.rLow, "rLow").toString(),
    receiptId: requireValue(log.args.receiptId, "receiptId"),
    sequence: requireValue(log.args.sequence, "sequence"),
    shares: requireValue(log.args.shares, "shares"),
    side: requireValue(log.args.side, "side"),
    transactionHash: requireValue(log.transactionHash, "transactionHash"),
  };
}

export async function persistReceiptPlacedRecord(
  record: ReceiptPlacedRecord,
  dbc: typeof db = db,
) {
  await dbc.transaction(async (tx) => {
    const costIncrement = record.cost.toString();
    const sharesIncrement = record.shares.toString();
    const inserted = await tx
      .insert(schema.receiptPlacedEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.receiptPlacedEvents.id });

    if (!inserted[0]) {
      return;
    }

    const updated = await tx
      .update(schema.markets)
      .set({
        receiptCount: record.sequence,
        totalEscrowed: sql`${schema.markets.totalEscrowed} + ${costIncrement}::numeric(78, 0)`,
        updatedAt: new Date(),
        ...(record.side === 0
          ? {
              yesShares: sql`${schema.markets.yesShares} + ${sharesIncrement}::numeric(78, 0)`,
            }
          : {
              noShares: sql`${schema.markets.noShares} + ${sharesIncrement}::numeric(78, 0)`,
            }),
      })
      .where(
        and(
          eq(schema.markets.chainId, record.chainId),
          eq(schema.markets.marketId, record.marketId),
        ),
      )
      .returning({ id: schema.markets.id });

    // Roll back the event insert too: committing it without the markets
    // projection would make the onConflictDoNothing dedup skip the counter
    // updates on every future replay of this receipt.
    if (!updated[0]) {
      throw new MarketNotIndexedError(record);
    }
  });
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`ReceiptPlaced log is missing ${name}.`);
  }

  return value;
}
