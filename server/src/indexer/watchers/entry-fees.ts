import { pregradManagerAbi } from "@popcharts/protocol";
import { getAbiItem } from "viem";

import { config } from "src/config";
import {
  buildEntryFeeCollectedRecord,
  buildEntryFeeEarnedRecord,
  buildEntryFeeRefundedRecord,
  buildEntryFeeWithdrawalRecord,
  persistEntryFeeWithdrawalRecord,
  persistReceiptEntryFeeRecord,
  retryUntilFeeParentsIndexed,
  type EarnedEntryFeesWithdrawnLog,
  type EntryFeeCollectedLog,
  type EntryFeeEarnedLog,
  type EntryFeeRefundedLog,
  type ReceiptEntryFeeRecord,
} from "src/indexer/handlers/entry-fees";
import { retryUntilMarketIndexed } from "src/indexer/handlers/market-projection";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getDefaultStartBlock } from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import {
  createDynamicAddressWatcher,
  staticContractSet,
  type DynamicWatcherLog,
} from "src/indexer/watchers/dynamic-address-watcher";

/**
 * Watches the four entry-fee events on the PregradManager so every fee
 * movement leaves an immutable receipt-linked row (protocol ADR 0014 §3,
 * docs/portfolio-data-design.md money invariant, docs/fee-model.md). One
 * watcher and one cursor for all four: they are one money surface, and a
 * single cursor means a receipt's `collected` row can never lag behind its
 * `refunded`/`earned` rows because of uneven per-event cursors.
 *
 * The fee rows foreign-key to `receipt_placed_events` and `markets`, both
 * written by independent watchers, and EntryFeeCollected shares its
 * transaction with ReceiptPlaced — so on the live path a fee log routinely
 * arrives first. The persists throw parkable errors for a missing parent and
 * the retry wrappers wait; exhausted retries park the sweep so the next pass
 * replays.
 */

const CURSOR_NAME = "EntryFees";
const LABEL = "EntryFees";

const ENTRY_FEE_EVENTS = (
  [
    "EntryFeeCollected",
    "EntryFeeRefunded",
    "EntryFeeEarned",
    "EarnedEntryFeesWithdrawn",
  ] as const
).map((name) => getAbiItem({ abi: pregradManagerAbi, name }));

type ReceiptFeeBuildContext = {
  blockTimestamp: Date;
  config: typeof config;
  contractId: number;
  log: DynamicWatcherLog;
};

/**
 * Builder per receipt-scoped event. The three share one persist and one retry
 * shape, so dispatch is a lookup rather than three copied cases — the same
 * move settlement.ts makes with SETTLEMENT_HANDLERS. The generic-log casts
 * are safe because each entry only runs for its own decoded eventName.
 */
// Exported for the dispatch-wiring test only: the map's value type cannot
// stop a key from being wired to the wrong builder, so the test pins each
// event name to the `kind` its builder produces.
export const RECEIPT_FEE_BUILDERS: Record<
  "EntryFeeCollected" | "EntryFeeRefunded" | "EntryFeeEarned",
  (context: ReceiptFeeBuildContext) => ReceiptEntryFeeRecord
> = {
  EntryFeeCollected: (context) =>
    buildEntryFeeCollectedRecord({
      ...context,
      log: context.log as EntryFeeCollectedLog,
    }),
  EntryFeeEarned: (context) =>
    buildEntryFeeEarnedRecord({
      ...context,
      log: context.log as EntryFeeEarnedLog,
    }),
  EntryFeeRefunded: (context) =>
    buildEntryFeeRefundedRecord({
      ...context,
      log: context.log as EntryFeeRefundedLog,
    }),
};

const watcher = createDynamicAddressWatcher({
  cursorName: CURSOR_NAME,
  events: ENTRY_FEE_EVENTS,
  fallbackStartBlock: (currentBlock) =>
    getDefaultStartBlock(CURSOR_NAME, currentBlock),
  handleLog: async (client, log) => {
    const contractId = await getOrCreateContractId(
      config.contracts.pregradManager,
      "PregradManager",
    );
    const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);

    if (log.eventName === "EarnedEntryFeesWithdrawn") {
      const record = buildEntryFeeWithdrawalRecord({
        blockTimestamp,
        config,
        contractId,
        log: log as EarnedEntryFeesWithdrawnLog,
      });
      console.log(
        `[${log.eventName}] marketId=${record.event.marketId} recipient=${record.event.recipient} amount=${record.event.amount}`,
      );
      // Market is the only parent here, so the market-specific retry names
      // the wait precisely in logs ("MarketCreated", not the fee-parents pair).
      await retryUntilMarketIndexed(
        () => persistEntryFeeWithdrawalRecord(record),
        {
          label: log.eventName,
        },
      );
      return;
    }

    const buildRecord =
      RECEIPT_FEE_BUILDERS[log.eventName as keyof typeof RECEIPT_FEE_BUILDERS];
    if (!buildRecord) {
      throw new Error(
        `EntryFees watcher received unexpected event: ${log.eventName}`,
      );
    }

    const record = buildRecord({ blockTimestamp, config, contractId, log });
    console.log(
      `[${log.eventName}] receiptId=${record.event.receiptId} marketId=${record.event.marketId} amount=${record.event.amount}`,
    );
    await retryUntilFeeParentsIndexed(
      () => persistReceiptEntryFeeRecord(record),
      {
        label: log.eventName!,
      },
    );
  },
  label: LABEL,
  subject: "pregrad manager",
  ...staticContractSet(() => config.contracts.pregradManager),
});

/** Catch-up sweep over entry-fee logs up to currentBlock. */
export const recoverEntryFeeEvents = watcher.recover;
/** Discovery loop + live subscription; returns a stop function. */
export const watchEntryFeeEvents = watcher.watch;
