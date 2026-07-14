import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";
import {
  baseEventFields,
  marketWhere,
  requireMarketUpdated,
  requireValue,
  unixSecondsToDate,
  type SettlementLog,
} from "src/indexer/handlers/settlement-shared";

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
  postgradMarket?: `0x${string}`;
  refundTotal?: bigint;
  retainedCostTotal?: bigint;
}>;

export type GraduationStartedRecord =
  typeof schema.graduationStartedEvents.$inferInsert;
export type ClearingRootSubmittedRecord =
  typeof schema.clearingRootSubmittedEvents.$inferInsert;
export type GraduationFinalizedRecord =
  typeof schema.graduationFinalizedEvents.$inferInsert;

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
    postgradMarket: requireValue(
      log.args.postgradMarket,
      "postgradMarket",
    ).toLowerCase(),
    refundTotal: requireValue(log.args.refundTotal, "refundTotal"),
    retainedCostTotal: requireValue(
      log.args.retainedCostTotal,
      "retainedCostTotal",
    ),
  };
}

export async function persistGraduationStartedRecord(
  record: GraduationStartedRecord,
  dbc: typeof db = db,
) {
  await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.graduationStartedEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.graduationStartedEvents.id });

    if (!inserted[0]) {
      return;
    }

    const updated = await tx
      .update(schema.markets)
      .set({
        noShares: record.noShares,
        receiptCount: record.receiptCount,
        status: "graduating",
        totalEscrowed: record.totalEscrowed,
        updatedAt: record.blockTimestamp,
        yesShares: record.yesShares,
      })
      .where(marketWhere(record))
      .returning({ id: schema.markets.id });

    requireMarketUpdated(updated, record);
  });
}

export async function persistClearingRootSubmittedRecord(
  record: ClearingRootSubmittedRecord,
  dbc: typeof db = db,
) {
  await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.clearingRootSubmittedEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.clearingRootSubmittedEvents.id });

    if (!inserted[0]) {
      return;
    }

    const updated = await tx
      .update(schema.markets)
      .set({
        status: "graduating",
        updatedAt: record.blockTimestamp,
      })
      .where(marketWhere(record))
      .returning({ id: schema.markets.id });

    requireMarketUpdated(updated, record);
  });
}

export async function persistGraduationFinalizedRecord(
  record: GraduationFinalizedRecord,
  dbc: typeof db = db,
) {
  await dbc.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.graduationFinalizedEvents)
      .values(record)
      .onConflictDoNothing()
      .returning({ id: schema.graduationFinalizedEvents.id });

    if (!inserted[0]) {
      return;
    }

    const updated = await tx
      .update(schema.markets)
      .set({
        status: "graduated",
        totalEscrowed: record.refundTotal,
        updatedAt: record.blockTimestamp,
      })
      .where(marketWhere(record))
      .returning({ id: schema.markets.id });

    requireMarketUpdated(updated, record);
  });
}
