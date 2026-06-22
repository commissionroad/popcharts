import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { and, db, eq, schema, sql } from "src/db/client";

type BaseSettlementArgs = {
  marketId?: bigint;
};

type SettlementLog<TArgs extends BaseSettlementArgs> = Log & {
  args: TArgs;
};

export type GraduationStartedLog = SettlementLog<{
  graduationStartedAt?: bigint;
  manager?: `0x${string}`;
  marketId?: bigint;
  noShares?: bigint;
  path?: bigint;
  receiptCount?: bigint;
  snapshotHash?: `0x${string}`;
  totalEscrowed?: bigint;
  yesShares?: bigint;
}>;

export type ClearingRootSubmittedLog = SettlementLog<{
  challengeDeadline?: bigint;
  completeSetCount?: bigint;
  marketId?: bigint;
  matchedMarketCap?: bigint;
  merkleRoot?: `0x${string}`;
  refundTotal?: bigint;
  retainedCostTotal?: bigint;
  snapshotHash?: `0x${string}`;
  submittedAt?: bigint;
  submitter?: `0x${string}`;
}>;

export type GraduationFinalizedLog = SettlementLog<{
  completeSetCount?: bigint;
  marketId?: bigint;
  postgradAdapter?: `0x${string}`;
  refundTotal?: bigint;
  retainedCostTotal?: bigint;
}>;

export type MarketRefundsAvailableLog = SettlementLog<{
  marketId?: bigint;
  totalEscrowed?: bigint;
}>;

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

export type GraduationStartedRecord =
  typeof schema.graduationStartedEvents.$inferInsert;
export type ClearingRootSubmittedRecord =
  typeof schema.clearingRootSubmittedEvents.$inferInsert;
export type GraduationFinalizedRecord =
  typeof schema.graduationFinalizedEvents.$inferInsert;
export type MarketRefundsAvailableRecord =
  typeof schema.marketRefundsAvailableEvents.$inferInsert;
export type GraduatedReceiptClaimedRecord =
  typeof schema.graduatedReceiptClaimedEvents.$inferInsert;
export type RefundedReceiptClaimedRecord =
  typeof schema.refundedReceiptClaimedEvents.$inferInsert;

export function buildGraduationStartedRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: GraduationStartedLog;
}): GraduationStartedRecord {
  const graduationStartedAtUnix = requireValue(
    log.args.graduationStartedAt,
    "graduationStartedAt",
  );

  return {
    ...baseEventFields({ blockTimestamp, config, contractId, log }),
    graduationStartedAt: unixSecondsToDate(graduationStartedAtUnix),
    graduationStartedAtUnix,
    manager: requireValue(log.args.manager, "manager").toLowerCase(),
    noShares: requireValue(log.args.noShares, "noShares"),
    path: requireValue(log.args.path, "path").toString(),
    receiptCount: requireValue(log.args.receiptCount, "receiptCount"),
    snapshotHash: requireValue(log.args.snapshotHash, "snapshotHash"),
    totalEscrowed: requireValue(log.args.totalEscrowed, "totalEscrowed"),
    yesShares: requireValue(log.args.yesShares, "yesShares"),
  };
}

export function buildClearingRootSubmittedRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: ClearingRootSubmittedLog;
}): ClearingRootSubmittedRecord {
  const submittedAtUnix = requireValue(log.args.submittedAt, "submittedAt");
  const challengeDeadlineUnix = requireValue(
    log.args.challengeDeadline,
    "challengeDeadline",
  );

  return {
    ...baseEventFields({ blockTimestamp, config, contractId, log }),
    challengeDeadline: unixSecondsToDate(challengeDeadlineUnix),
    challengeDeadlineUnix,
    completeSetCount: requireValue(
      log.args.completeSetCount,
      "completeSetCount",
    ),
    matchedMarketCap: requireValue(
      log.args.matchedMarketCap,
      "matchedMarketCap",
    ),
    merkleRoot: requireValue(log.args.merkleRoot, "merkleRoot"),
    refundTotal: requireValue(log.args.refundTotal, "refundTotal"),
    retainedCostTotal: requireValue(
      log.args.retainedCostTotal,
      "retainedCostTotal",
    ),
    snapshotHash: requireValue(log.args.snapshotHash, "snapshotHash"),
    submittedAt: unixSecondsToDate(submittedAtUnix),
    submittedAtUnix,
    submitter: requireValue(log.args.submitter, "submitter").toLowerCase(),
  };
}

export function buildGraduationFinalizedRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
  log: GraduationFinalizedLog;
}): GraduationFinalizedRecord {
  return {
    ...baseEventFields({ blockTimestamp, config, contractId, log }),
    completeSetCount: requireValue(
      log.args.completeSetCount,
      "completeSetCount",
    ),
    postgradAdapter: requireValue(
      log.args.postgradAdapter,
      "postgradAdapter",
    ).toLowerCase(),
    refundTotal: requireValue(log.args.refundTotal, "refundTotal"),
    retainedCostTotal: requireValue(
      log.args.retainedCostTotal,
      "retainedCostTotal",
    ),
  };
}

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

export async function persistGraduationStartedRecord(
  record: GraduationStartedRecord,
) {
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.graduationStartedEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.graduationStartedEvents.id });

    if (!inserted[0]) {
      return;
    }

    await tx
      .update(schema.markets)
      .set({
        noShares: record.noShares,
        receiptCount: record.receiptCount,
        status: "graduating",
        totalEscrowed: record.totalEscrowed,
        updatedAt: record.blockTimestamp,
        yesShares: record.yesShares,
      })
      .where(marketWhere(record));
  });
}

export async function persistClearingRootSubmittedRecord(
  record: ClearingRootSubmittedRecord,
) {
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.clearingRootSubmittedEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.clearingRootSubmittedEvents.id });

    if (!inserted[0]) {
      return;
    }

    await tx
      .update(schema.markets)
      .set({
        status: "graduating",
        updatedAt: record.blockTimestamp,
      })
      .where(marketWhere(record));
  });
}

export async function persistGraduationFinalizedRecord(
  record: GraduationFinalizedRecord,
) {
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.graduationFinalizedEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.graduationFinalizedEvents.id });

    if (!inserted[0]) {
      return;
    }

    await tx
      .update(schema.markets)
      .set({
        status: "graduated",
        totalEscrowed: record.refundTotal,
        updatedAt: record.blockTimestamp,
      })
      .where(marketWhere(record));
  });
}

export async function persistMarketRefundsAvailableRecord(
  record: MarketRefundsAvailableRecord,
) {
  await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.marketRefundsAvailableEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.marketRefundsAvailableEvents.id });

    if (!inserted[0]) {
      return;
    }

    await tx
      .update(schema.markets)
      .set({
        status: "refunded",
        totalEscrowed: record.totalEscrowed,
        updatedAt: record.blockTimestamp,
      })
      .where(marketWhere(record));
  });
}

export async function persistGraduatedReceiptClaimedRecord(
  record: GraduatedReceiptClaimedRecord,
) {
  await persistReceiptSettlementRecord({
    record,
    table: schema.graduatedReceiptClaimedEvents,
  });
}

export async function persistRefundedReceiptClaimedRecord(
  record: RefundedReceiptClaimedRecord,
) {
  await persistReceiptSettlementRecord({
    record,
    table: schema.refundedReceiptClaimedEvents,
  });
}

function baseEventFields<TArgs extends BaseSettlementArgs>({
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

async function persistReceiptSettlementRecord({
  record,
  table,
}: {
  record: GraduatedReceiptClaimedRecord | RefundedReceiptClaimedRecord;
  table:
    | typeof schema.graduatedReceiptClaimedEvents
    | typeof schema.refundedReceiptClaimedEvents;
}) {
  await db.transaction(async (tx) => {
    const refundDecrement = record.refund.toString();
    const inserted = await tx
      .insert(table)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: table.id });

    if (!inserted[0]) {
      return;
    }

    await tx
      .update(schema.markets)
      .set({
        totalEscrowed: sql`${schema.markets.totalEscrowed} - ${refundDecrement}::numeric(78, 0)`,
        updatedAt: record.blockTimestamp,
      })
      .where(marketWhere(record));
  });
}

function marketWhere(record: { chainId: number; marketId: bigint }) {
  return and(
    eq(schema.markets.chainId, record.chainId),
    eq(schema.markets.marketId, record.marketId),
  );
}

function requireValue<T>(value: T | null | undefined, name: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Settlement log is missing ${name}.`);
  }

  return value;
}

function unixSecondsToDate(value: bigint) {
  return new Date(Number(value) * 1000);
}
