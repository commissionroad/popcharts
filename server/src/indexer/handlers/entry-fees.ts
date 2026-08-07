import { and, eq } from "drizzle-orm";
import type { Log } from "viem";

import type { NetworkConfig } from "src/config";
import { db, schema } from "src/db/client";
import {
  MarketNotIndexedError,
  requireMarketRowIndexed,
} from "src/indexer/handlers/market-projection";
import { logValueRequirer } from "src/indexer/utils/log-values";
import { ParkSweepError } from "src/indexer/utils/park-sweep-error";
import { retryUntilIndexed } from "src/indexer/utils/retry-until-indexed";

const requireValue = logValueRequirer("Entry fee log");

/**
 * A fee log arrived before its receipt's ReceiptPlaced row. EntryFeeCollected
 * shares a transaction with ReceiptPlaced but the two are consumed by
 * independent watchers, so on the live path this is expected, not an error in
 * the data. ParkSweepError base for the same reason as MarketNotIndexedError:
 * the watcher parks this address below the log and the next sweep retries,
 * instead of the raw foreign-key violation aborting the whole pass.
 */
export class ReceiptNotIndexedError extends ParkSweepError {
  constructor({ chainId, receiptId }: { chainId: number; receiptId: bigint }) {
    super(
      `Receipt ${receiptId} on chain ${chainId} is not indexed yet; ` +
        `waiting for its ReceiptPlaced row before recording an entry fee against it.`,
    );
    this.name = "ReceiptNotIndexedError";
  }
}

/**
 * Decoded log shapes for the four PregradManager entry-fee events. viem
 * decodes args from the generated ABI; every field is optional at the type
 * level because viem cannot promise topics decoded, so the builders assert
 * each one through `requireValue` before a row is written.
 */
export type EntryFeeCollectedLog = Log & {
  args: {
    receiptId?: bigint;
    marketId?: bigint;
    payer?: string;
    amount?: bigint;
  };
};

export type EntryFeeRefundedLog = Log & {
  args: {
    receiptId?: bigint;
    marketId?: bigint;
    recipient?: string;
    amount?: bigint;
  };
};

export type EntryFeeEarnedLog = Log & {
  args: { receiptId?: bigint; marketId?: bigint; amount?: bigint };
};

export type EarnedEntryFeesWithdrawnLog = Log & {
  args: { marketId?: bigint; recipient?: string; amount?: bigint };
};

/**
 * Insert-ready rows for the two fee tables, wrapped in the same one-field
 * `{ event }` envelope the sibling handlers use so persist signatures stay
 * uniform across the indexer.
 */
export type ReceiptEntryFeeRecord = {
  event: typeof schema.receiptEntryFeeEvents.$inferInsert;
};

export type EntryFeeWithdrawalRecord = {
  event: typeof schema.entryFeeWithdrawalEvents.$inferInsert;
};

type BuildContext = {
  blockTimestamp: Date;
  config: Pick<NetworkConfig, "chainId">;
  contractId: number;
};

/**
 * Shared row shape for the three receipt-scoped fee events. `account` carries
 * whichever wallet the event names — the payer for `collected`, the refund
 * recipient for `refunded` — and is null exactly for `earned`, where the
 * counterparty is the protocol and the contract emits no address.
 */
function buildReceiptEntryFeeRow(
  { blockTimestamp, config, contractId }: BuildContext,
  log: EntryFeeEarnedLog,
  kind: (typeof schema.entryFeeEventKind.enumValues)[number],
  account: string | null,
): ReceiptEntryFeeRecord {
  return {
    event: {
      account,
      amount: requireValue(log.args.amount, "amount"),
      blockNumber: requireValue(log.blockNumber, "blockNumber"),
      blockTimestamp,
      chainId: config.chainId,
      contractId,
      kind,
      logIndex: requireValue(log.logIndex, "logIndex"),
      marketId: requireValue(log.args.marketId, "marketId"),
      receiptId: requireValue(log.args.receiptId, "receiptId"),
      transactionHash: requireValue(log.transactionHash, "transactionHash"),
    },
  };
}

/** Maps an EntryFeeCollected log into a `collected` paper-trail row. */
export function buildEntryFeeCollectedRecord(
  context: BuildContext & { log: EntryFeeCollectedLog },
): ReceiptEntryFeeRecord {
  return buildReceiptEntryFeeRow(
    context,
    context.log,
    "collected",
    requireValue(context.log.args.payer, "payer").toLowerCase(),
  );
}

/** Maps an EntryFeeRefunded log into a `refunded` paper-trail row. */
export function buildEntryFeeRefundedRecord(
  context: BuildContext & { log: EntryFeeRefundedLog },
): ReceiptEntryFeeRecord {
  return buildReceiptEntryFeeRow(
    context,
    context.log,
    "refunded",
    requireValue(context.log.args.recipient, "recipient").toLowerCase(),
  );
}

/** Maps an EntryFeeEarned log into an `earned` paper-trail row. */
export function buildEntryFeeEarnedRecord(
  context: BuildContext & { log: EntryFeeEarnedLog },
): ReceiptEntryFeeRecord {
  return buildReceiptEntryFeeRow(context, context.log, "earned", null);
}

/** Maps an EarnedEntryFeesWithdrawn log into a withdrawal paper-trail row. */
export function buildEntryFeeWithdrawalRecord({
  blockTimestamp,
  config,
  contractId,
  log,
}: BuildContext & {
  log: EarnedEntryFeesWithdrawnLog;
}): EntryFeeWithdrawalRecord {
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

/**
 * Persists one receipt-scoped fee row. Append-only and deduped on
 * (chain, tx, log), so a replay is a no-op rather than a double-counted
 * movement; there is no projection to update.
 *
 * The row foreign-keys to both `receipt_placed_events` and `markets`, and a
 * receipt row's presence does not imply its market row's presence — the two
 * come from independent watchers — so both parents are required explicitly.
 * Either miss is a parkable error; the watcher's retry treats them alike.
 */
export async function persistReceiptEntryFeeRecord(
  record: ReceiptEntryFeeRecord,
  dbc: typeof db = db,
) {
  const { chainId, marketId, receiptId } = record.event;

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
    throw new ReceiptNotIndexedError({ chainId, receiptId });
  }

  await requireMarketRowIndexed(chainId, marketId, dbc);

  await dbc
    .insert(schema.receiptEntryFeeEvents)
    .values(record.event)
    .onConflictDoNothing();
}

/**
 * Persists one earned-fee withdrawal row. Market-scoped: the pot aggregates
 * many receipts' earned shares, so there is no receipt parent to wait for.
 */
export async function persistEntryFeeWithdrawalRecord(
  record: EntryFeeWithdrawalRecord,
  dbc: typeof db = db,
) {
  await requireMarketRowIndexed(
    record.event.chainId,
    record.event.marketId,
    dbc,
  );

  await dbc
    .insert(schema.entryFeeWithdrawalEvents)
    .values(record.event)
    .onConflictDoNothing();
}

/**
 * Retries a fee persist while either parent row is still missing. One wrapper
 * for both parent kinds: EntryFeeCollected races ReceiptPlaced in the same
 * transaction, and every fee event races MarketCreated on a cold backfill.
 * Exhausted retries rethrow the ParkSweepError so the sweep parks and the
 * next pass replays the log.
 */
export async function retryUntilFeeParentsIndexed<T>(
  operation: () => Promise<T>,
  { label }: { label: string },
): Promise<T> {
  return retryUntilIndexed(operation, {
    isRetryable: (error) =>
      error instanceof ReceiptNotIndexedError ||
      error instanceof MarketNotIndexedError,
    label,
    waitingFor: "ReceiptPlaced/MarketCreated",
  });
}
