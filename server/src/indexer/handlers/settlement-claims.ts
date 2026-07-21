import type { NetworkConfig } from "src/config";
import { db, schema, sql } from "src/db/client";
import {
  baseEventFields,
  marketWhere,
  requireMarketUpdated,
  requireValue,
  type SettlementLog,
} from "src/indexer/handlers/settlement-shared";
import { recordLiveChange } from "src/live/change-feed-writer";
import type { ChangeFeedSourceTable } from "src/live/change-feed-sources";

export type GraduatedReceiptClaimedLog = SettlementLog<{
  marketId?: bigint;
  owner?: `0x${string}`;
  receiptId?: bigint;
  refund?: bigint;
  retainedCost?: bigint;
  retainedShares?: bigint;
  side?: number;
}>;

export type RefundedReceiptClaimedLog = SettlementLog<{
  marketId?: bigint;
  owner?: `0x${string}`;
  receiptId?: bigint;
  refund?: bigint;
}>;

export type GraduatedReceiptClaimedRecord =
  typeof schema.graduatedReceiptClaimedEvents.$inferInsert;
export type RefundedReceiptClaimedRecord =
  typeof schema.refundedReceiptClaimedEvents.$inferInsert;

export function buildGraduatedReceiptClaimedRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: GraduatedReceiptClaimedLog;
}): GraduatedReceiptClaimedRecord {
  return {
    ...baseEventFields({ blockTimestamp, config, contractId, log }),
    owner: requireValue(log.args.owner, "owner").toLowerCase(),
    receiptId: requireValue(log.args.receiptId, "receiptId"),
    refund: requireValue(log.args.refund, "refund"),
    retainedCost: requireValue(log.args.retainedCost, "retainedCost"),
    retainedShares: requireValue(log.args.retainedShares, "retainedShares"),
    side: requireValue(log.args.side, "side"),
  };
}

export function buildRefundedReceiptClaimedRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: RefundedReceiptClaimedLog;
}): RefundedReceiptClaimedRecord {
  return {
    ...baseEventFields({ blockTimestamp, config, contractId, log }),
    owner: requireValue(log.args.owner, "owner").toLowerCase(),
    receiptId: requireValue(log.args.receiptId, "receiptId"),
    refund: requireValue(log.args.refund, "refund"),
  };
}

export async function persistGraduatedReceiptClaimedRecord(
  record: GraduatedReceiptClaimedRecord,
  dbc: typeof db = db,
) {
  await persistReceiptSettlementRecord({
    dbc,
    record,
    sourceTable: "graduated_receipt_claimed_events",
    table: schema.graduatedReceiptClaimedEvents,
  });
}

export async function persistRefundedReceiptClaimedRecord(
  record: RefundedReceiptClaimedRecord,
  dbc: typeof db = db,
) {
  await persistReceiptSettlementRecord({
    dbc,
    record,
    sourceTable: "refunded_receipt_claimed_events",
    table: schema.refundedReceiptClaimedEvents,
  });
}

async function persistReceiptSettlementRecord({
  dbc,
  record,
  sourceTable,
  table,
}: {
  dbc: typeof db;
  record: GraduatedReceiptClaimedRecord | RefundedReceiptClaimedRecord;
  sourceTable: ChangeFeedSourceTable;
  table:
    | typeof schema.graduatedReceiptClaimedEvents
    | typeof schema.refundedReceiptClaimedEvents;
}) {
  await dbc.transaction(async (tx) => {
    const refundDecrement = record.refund.toString();
    const inserted = await tx
      .insert(table)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: table.id });

    if (!inserted[0]) {
      return;
    }

    const updated = await tx
      .update(schema.markets)
      .set({
        totalEscrowed: sql`${schema.markets.totalEscrowed} - ${refundDecrement}::numeric(78, 0)`,
        updatedAt: record.blockTimestamp,
      })
      .where(marketWhere(record))
      .returning({ id: schema.markets.id });

    requireMarketUpdated(updated, record);

    // Money paper trail: signal the market and the claimant's portfolio, atomic
    // with the claim row + escrow decrement.
    await recordLiveChange(tx, {
      sourceTable,
      op: "insert",
      chainId: record.chainId,
      marketId: record.marketId,
      owner: record.owner,
      rowId: inserted[0].id,
      blockNumber: record.blockNumber,
      logIndex: record.logIndex,
    });
  });
}
