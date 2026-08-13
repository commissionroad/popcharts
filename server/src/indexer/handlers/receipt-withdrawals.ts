import { and, eq } from "drizzle-orm";
import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";
import { serializeWithdrawalSegments } from "src/db/schema/withdrawal-events";
import { ReceiptNotIndexedError } from "src/indexer/handlers/entry-fees";
import { requireMarketRowIndexed } from "src/indexer/handlers/market-projection";
import { logValueRequirer } from "src/indexer/utils/log-values";
import { unixSecondsToDate } from "src/indexer/utils/unix-seconds";

const requireValue = logValueRequirer("Withdrawal log");

/**
 * Decoded log shapes for the seven PregradManager withdrawal events
 * (protocol ADR 0014 P3/P4b). Every field is optional at the type level
 * because viem cannot promise topics decoded, so the builders assert each one
 * through `requireValue` before a row is written.
 */
export type ReceiptWithdrawalRequestedLog = Log & {
  args: {
    requestId?: bigint;
    receiptId?: bigint;
    marketId?: bigint;
    owner?: string;
    segments?: readonly { rHigh: bigint; rLow: bigint }[];
    grossRefund?: bigint;
    withdrawalFee?: bigint;
    entryFeeRefund?: bigint;
    challengeDeadline?: bigint;
    nextReceiptIdSnapshot?: bigint;
  };
};

export type ReceiptWithdrawalRefutedLog = Log & {
  args: {
    requestId?: bigint;
    receiptId?: bigint;
    marketId?: bigint;
    challenger?: string;
    refutingReceiptId?: bigint;
  };
};

export type ReceiptWithdrawalFinalizedLog = Log & {
  args: {
    requestId?: bigint;
    receiptId?: bigint;
    marketId?: bigint;
    owner?: string;
    escrowRefund?: bigint;
    entryFeeRefund?: bigint;
    withdrawalFee?: bigint;
  };
};

export type ReceiptWithdrawalVoidedLog = Log & {
  args: { requestId?: bigint; receiptId?: bigint; marketId?: bigint };
};

export type WithdrawalFeeRateUpdatedLog = Log & {
  args: { previousRateWad?: bigint; newRateWad?: bigint };
};

export type WithdrawalChallengePeriodUpdatedLog = Log & {
  args: { previousPeriod?: bigint; newPeriod?: bigint };
};

export type EarnedWithdrawalFeesWithdrawnLog = Log & {
  args: { marketId?: bigint; recipient?: string; amount?: bigint };
};

/**
 * Insert-ready rows for the three withdrawal tables, wrapped in the same
 * one-field `{ event }` envelope the sibling handlers use so persist
 * signatures stay uniform across the indexer.
 */
export type ReceiptWithdrawalRecord = {
  event: typeof schema.receiptWithdrawalEvents.$inferInsert;
};

export type WithdrawalConfigRecord = {
  event: typeof schema.withdrawalConfigEvents.$inferInsert;
};

export type WithdrawalFeeWithdrawalRecord = {
  event: typeof schema.withdrawalFeeWithdrawalEvents.$inferInsert;
};

type BuildContext = {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
};

/**
 * Shared row skeleton for the four lifecycle kinds: the identifying triple
 * plus the log key, with every per-kind column defaulted null so each builder
 * states only what its event carries.
 */
function buildLifecycleRow(
  { blockTimestamp, config, contractId }: BuildContext,
  log: ReceiptWithdrawalVoidedLog,
  kind: (typeof schema.withdrawalEventKind.enumValues)[number],
  account: string | null,
): ReceiptWithdrawalRecord["event"] {
  return {
    account,
    blockNumber: requireValue(log.blockNumber, "blockNumber"),
    blockTimestamp,
    chainId: config.chainId,
    contractId,
    kind,
    logIndex: requireValue(log.logIndex, "logIndex"),
    marketId: requireValue(log.args.marketId, "marketId"),
    receiptId: requireValue(log.args.receiptId, "receiptId"),
    requestId: requireValue(log.args.requestId, "requestId"),
    transactionHash: requireValue(log.transactionHash, "transactionHash"),
  };
}

/**
 * Maps a ReceiptWithdrawalRequested log into a `requested` row: the priced
 * claim (gross, request-time fee, pro-rated entry-fee share) and the race
 * stamps (deadline, snapshot), before any money moves.
 */
export function buildReceiptWithdrawalRequestedRecord(
  context: BuildContext & { log: ReceiptWithdrawalRequestedLog },
): ReceiptWithdrawalRecord {
  const { log } = context;
  const challengeDeadlineUnix = requireValue(
    log.args.challengeDeadline,
    "challengeDeadline",
  );

  return {
    event: {
      ...buildLifecycleRow(
        context,
        log,
        "requested",
        requireValue(log.args.owner, "owner").toLowerCase(),
      ),
      challengeDeadline: unixSecondsToDate(challengeDeadlineUnix),
      challengeDeadlineUnix,
      entryFeeRefund: requireValue(log.args.entryFeeRefund, "entryFeeRefund"),
      grossRefund: requireValue(log.args.grossRefund, "grossRefund"),
      nextReceiptIdSnapshot: requireValue(
        log.args.nextReceiptIdSnapshot,
        "nextReceiptIdSnapshot",
      ),
      segments: serializeWithdrawalSegments(
        requireValue(log.args.segments, "segments"),
      ),
      withdrawalFee: requireValue(log.args.withdrawalFee, "withdrawalFee"),
    },
  };
}

/** Maps a ReceiptWithdrawalRefuted log into a `refuted` row. */
export function buildReceiptWithdrawalRefutedRecord(
  context: BuildContext & { log: ReceiptWithdrawalRefutedLog },
): ReceiptWithdrawalRecord {
  const { log } = context;
  return {
    event: {
      ...buildLifecycleRow(
        context,
        log,
        "refuted",
        requireValue(log.args.challenger, "challenger").toLowerCase(),
      ),
      refutingReceiptId: requireValue(
        log.args.refutingReceiptId,
        "refutingReceiptId",
      ),
    },
  };
}

/**
 * Maps a ReceiptWithdrawalFinalized log into a `finalized` row — the one
 * transfer of the lifecycle, with the payout split into escrowRefund +
 * entryFeeRefund and the withdrawalFee kept by the protocol.
 */
export function buildReceiptWithdrawalFinalizedRecord(
  context: BuildContext & { log: ReceiptWithdrawalFinalizedLog },
): ReceiptWithdrawalRecord {
  const { log } = context;
  return {
    event: {
      ...buildLifecycleRow(
        context,
        log,
        "finalized",
        requireValue(log.args.owner, "owner").toLowerCase(),
      ),
      entryFeeRefund: requireValue(log.args.entryFeeRefund, "entryFeeRefund"),
      escrowRefund: requireValue(log.args.escrowRefund, "escrowRefund"),
      withdrawalFee: requireValue(log.args.withdrawalFee, "withdrawalFee"),
    },
  };
}

/** Maps a ReceiptWithdrawalVoided log into a `voided` row. */
export function buildReceiptWithdrawalVoidedRecord(
  context: BuildContext & { log: ReceiptWithdrawalVoidedLog },
): ReceiptWithdrawalRecord {
  return { event: buildLifecycleRow(context, context.log, "voided", null) };
}

/** Maps a WithdrawalFeeRateUpdated log into a `fee_rate` config row. */
export function buildWithdrawalFeeRateRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: BuildContext & {
  log: WithdrawalFeeRateUpdatedLog;
}): WithdrawalConfigRecord {
  return {
    event: {
      blockNumber: requireValue(log.blockNumber, "blockNumber"),
      blockTimestamp,
      chainId: config.chainId,
      contractId,
      kind: "fee_rate",
      logIndex: requireValue(log.logIndex, "logIndex"),
      newValue: requireValue(log.args.newRateWad, "newRateWad"),
      previousValue: requireValue(log.args.previousRateWad, "previousRateWad"),
      transactionHash: requireValue(log.transactionHash, "transactionHash"),
    },
  };
}

/**
 * Maps a WithdrawalChallengePeriodUpdated log into a `challenge_period`
 * config row (values in seconds).
 */
export function buildWithdrawalChallengePeriodRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: BuildContext & {
  log: WithdrawalChallengePeriodUpdatedLog;
}): WithdrawalConfigRecord {
  return {
    event: {
      blockNumber: requireValue(log.blockNumber, "blockNumber"),
      blockTimestamp,
      chainId: config.chainId,
      contractId,
      kind: "challenge_period",
      logIndex: requireValue(log.logIndex, "logIndex"),
      newValue: requireValue(log.args.newPeriod, "newPeriod"),
      previousValue: requireValue(log.args.previousPeriod, "previousPeriod"),
      transactionHash: requireValue(log.transactionHash, "transactionHash"),
    },
  };
}

/** Maps an EarnedWithdrawalFeesWithdrawn log into a sweep paper-trail row. */
export function buildWithdrawalFeeWithdrawalRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: BuildContext & {
  log: EarnedWithdrawalFeesWithdrawnLog;
}): WithdrawalFeeWithdrawalRecord {
  return {
    event: {
      amount: requireValue(log.args.amount, "amount"),
      blockNumber: requireValue(log.blockNumber, "blockNumber"),
      blockTimestamp,
      chainId: config.chainId,
      contractId,
      logIndex: requireValue(log.logIndex, "logIndex"),
      marketId: requireValue(log.args.marketId, "marketId"),
      recipient: requireValue(log.args.recipient, "recipient").toLowerCase(),
      transactionHash: requireValue(log.transactionHash, "transactionHash"),
    },
  };
}

/** Parks unless (chainId, receiptId) has its ReceiptPlaced row. */
async function requireReceiptRowIndexed(
  chainId: number,
  receiptId: bigint,
  action: string,
  dbc: typeof db,
) {
  const [receipt] = await dbc
    .select({ id: schema.receiptPlacedEvents.id })
    .from(schema.receiptPlacedEvents)
    .where(
      and(
        eq(schema.receiptPlacedEvents.chainId, chainId),
        eq(schema.receiptPlacedEvents.receiptId, receiptId),
      ),
    );

  if (!receipt) {
    throw new ReceiptNotIndexedError({ action, chainId, receiptId });
  }
}

/**
 * Persists one withdrawal lifecycle row. Append-only and deduped on
 * (chain, tx, log), so a replay is a no-op rather than a double-counted
 * movement; there is no projection to update.
 *
 * Three parents may be missing, each from an independent watcher: the
 * withdrawing receipt's ReceiptPlaced row, the `refuted` kind's refuting
 * receipt (placed strictly before the refutation, but by the receipt
 * watcher), and the market row. Each miss is a parkable error; the watcher's
 * retry treats them alike.
 *
 * Ledger conservation (protocol ADR 0014 §3/P3): finalization pays
 * escrowRefund + entryFeeRefund in ONE transfer and emits ONLY
 * ReceiptWithdrawalFinalized — the contract deliberately does not emit
 * EntryFeeRefunded for it, and it decrements the receipt's held entryFeePaid
 * by the refunded share. The entry-fee ledger must stay conservative per
 * receipt (collected == earned + refunded across all paths), so a `finalized`
 * row with a non-zero entryFeeRefund ALSO writes the `refunded` movement into
 * receipt_entry_fee_events here, keyed by the finalized log's own
 * (chain, tx, log) — the entry-fee watcher never consumes that event, so the
 * key cannot collide, and the nightly reconciler expects exactly this row
 * from the same log. Zero refunds write nothing, matching the entry-fee
 * convention that an absent row means "no fee was due". Both inserts share a
 * transaction so no crash can strand the ledgers disagreeing.
 */
export async function persistReceiptWithdrawalRecord(
  record: ReceiptWithdrawalRecord,
  dbc: typeof db = db,
) {
  const { chainId, marketId, receiptId, refutingReceiptId } = record.event;

  await requireReceiptRowIndexed(
    chainId,
    receiptId,
    "recording a withdrawal event against it",
    dbc,
  );
  if (refutingReceiptId !== null && refutingReceiptId !== undefined) {
    await requireReceiptRowIndexed(
      chainId,
      refutingReceiptId,
      "recording it as a withdrawal refutation's counterexample",
      dbc,
    );
  }
  await requireMarketRowIndexed(chainId, marketId, dbc);

  const entryFeeRefund =
    record.event.kind === "finalized"
      ? (record.event.entryFeeRefund ?? 0n)
      : 0n;

  await dbc.transaction(async (tx) => {
    await tx
      .insert(schema.receiptWithdrawalEvents)
      .values(record.event)
      .onConflictDoNothing();

    if (entryFeeRefund > 0n) {
      await tx
        .insert(schema.receiptEntryFeeEvents)
        .values({
          account: record.event.account,
          amount: entryFeeRefund,
          blockNumber: record.event.blockNumber,
          blockTimestamp: record.event.blockTimestamp,
          chainId,
          contractId: record.event.contractId,
          kind: "refunded",
          logIndex: record.event.logIndex,
          marketId,
          receiptId,
          transactionHash: record.event.transactionHash,
        })
        .onConflictDoNothing();
    }
  });
}

/**
 * Persists one manager-global config row. No parents: the rate and window
 * exist before any market does.
 */
export async function persistWithdrawalConfigRecord(
  record: WithdrawalConfigRecord,
  dbc: typeof db = db,
) {
  await dbc
    .insert(schema.withdrawalConfigEvents)
    .values(record.event)
    .onConflictDoNothing();
}

/**
 * Persists one earned-fee sweep row. Market-scoped: the pot aggregates many
 * requests' fees, so there is no receipt parent to wait for.
 */
export async function persistWithdrawalFeeWithdrawalRecord(
  record: WithdrawalFeeWithdrawalRecord,
  dbc: typeof db = db,
) {
  await requireMarketRowIndexed(
    record.event.chainId,
    record.event.marketId,
    dbc,
  );

  await dbc
    .insert(schema.withdrawalFeeWithdrawalEvents)
    .values(record.event)
    .onConflictDoNothing();
}
