import { pregradManagerAbi } from "@popcharts/protocol";
import { getAbiItem } from "viem";

import { config } from "src/config";
import { retryUntilFeeParentsIndexed } from "src/indexer/handlers/entry-fees";
import { retryUntilMarketIndexed } from "src/indexer/handlers/market-projection";
import {
  buildReceiptWithdrawalFinalizedRecord,
  buildReceiptWithdrawalRefutedRecord,
  buildReceiptWithdrawalRequestedRecord,
  buildReceiptWithdrawalVoidedRecord,
  buildWithdrawalChallengePeriodRecord,
  buildWithdrawalFeeRateRecord,
  buildWithdrawalFeeWithdrawalRecord,
  persistReceiptWithdrawalRecord,
  persistWithdrawalConfigRecord,
  persistWithdrawalFeeWithdrawalRecord,
  type EarnedWithdrawalFeesWithdrawnLog,
  type ReceiptWithdrawalFinalizedLog,
  type ReceiptWithdrawalRecord,
  type ReceiptWithdrawalRefutedLog,
  type ReceiptWithdrawalRequestedLog,
  type ReceiptWithdrawalVoidedLog,
  type WithdrawalChallengePeriodUpdatedLog,
  type WithdrawalConfigRecord,
  type WithdrawalFeeRateUpdatedLog,
} from "src/indexer/handlers/receipt-withdrawals";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getDefaultStartBlock } from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import {
  createDynamicAddressWatcher,
  staticContractSet,
  type DynamicWatcherLog,
} from "src/indexer/watchers/dynamic-address-watcher";

/**
 * Watches the seven withdrawal events on the PregradManager (protocol
 * ADR 0014 P3/P4b) so every withdrawal-request movement leaves an immutable
 * receipt-linked row (docs/portfolio-data-design.md money invariant). One
 * watcher and one cursor for the whole set, the EntryFees shape: they are one
 * money surface, and a single cursor means a request's `requested` row can
 * never lag behind its terminal row because of uneven per-event cursors.
 *
 * The lifecycle rows foreign-key to `receipt_placed_events` (twice, for the
 * refuted kind) and `markets`, all written by independent watchers, so on the
 * live path a withdrawal log can arrive first. The persists throw parkable
 * errors for a missing parent and the retry wrappers wait; exhausted retries
 * park the sweep so the next pass replays.
 */

const CURSOR_NAME = "ReceiptWithdrawals";
const LABEL = "ReceiptWithdrawals";

const WITHDRAWAL_EVENTS = (
  [
    "ReceiptWithdrawalRequested",
    "ReceiptWithdrawalRefuted",
    "ReceiptWithdrawalFinalized",
    "ReceiptWithdrawalVoided",
    "WithdrawalFeeRateUpdated",
    "WithdrawalChallengePeriodUpdated",
    "EarnedWithdrawalFeesWithdrawn",
  ] as const
).map((name) => getAbiItem({ abi: pregradManagerAbi, name }));

type WithdrawalBuildContext = {
  blockTimestamp: Date;
  config: typeof config;
  contractId: number;
  log: DynamicWatcherLog;
};

/**
 * Builder per lifecycle event. The four share one persist and one retry
 * shape, so dispatch is a lookup rather than four copied cases — the same
 * move the EntryFees watcher makes with RECEIPT_FEE_BUILDERS. The generic-log
 * casts are safe because each entry only runs for its own decoded eventName.
 */
// Exported for the dispatch-wiring test only: the map's value type cannot
// stop a key from being wired to the wrong builder, so the test pins each
// event name to the `kind` its builder produces.
export const RECEIPT_WITHDRAWAL_BUILDERS: Record<
  | "ReceiptWithdrawalRequested"
  | "ReceiptWithdrawalRefuted"
  | "ReceiptWithdrawalFinalized"
  | "ReceiptWithdrawalVoided",
  (context: WithdrawalBuildContext) => ReceiptWithdrawalRecord
> = {
  ReceiptWithdrawalFinalized: (context) =>
    buildReceiptWithdrawalFinalizedRecord({
      ...context,
      log: context.log as ReceiptWithdrawalFinalizedLog,
    }),
  ReceiptWithdrawalRefuted: (context) =>
    buildReceiptWithdrawalRefutedRecord({
      ...context,
      log: context.log as ReceiptWithdrawalRefutedLog,
    }),
  ReceiptWithdrawalRequested: (context) =>
    buildReceiptWithdrawalRequestedRecord({
      ...context,
      log: context.log as ReceiptWithdrawalRequestedLog,
    }),
  ReceiptWithdrawalVoided: (context) =>
    buildReceiptWithdrawalVoidedRecord({
      ...context,
      log: context.log as ReceiptWithdrawalVoidedLog,
    }),
};

/**
 * Builder per manager-global config event; exported for the same wiring test.
 * No parents and no retry — the rate and window exist before any market does.
 */
export const WITHDRAWAL_CONFIG_BUILDERS: Record<
  "WithdrawalFeeRateUpdated" | "WithdrawalChallengePeriodUpdated",
  (context: WithdrawalBuildContext) => WithdrawalConfigRecord
> = {
  WithdrawalChallengePeriodUpdated: (context) =>
    buildWithdrawalChallengePeriodRecord({
      ...context,
      log: context.log as WithdrawalChallengePeriodUpdatedLog,
    }),
  WithdrawalFeeRateUpdated: (context) =>
    buildWithdrawalFeeRateRecord({
      ...context,
      log: context.log as WithdrawalFeeRateUpdatedLog,
    }),
};

const watcher = createDynamicAddressWatcher({
  cursorName: CURSOR_NAME,
  events: WITHDRAWAL_EVENTS,
  fallbackStartBlock: (currentBlock) =>
    getDefaultStartBlock(CURSOR_NAME, currentBlock),
  handleLog: async (client, log) => {
    const contractId = await getOrCreateContractId(
      config.contracts.pregradManager,
      "PregradManager",
    );
    const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
    const context = { blockTimestamp, config, contractId, log };

    if (log.eventName === "EarnedWithdrawalFeesWithdrawn") {
      const record = buildWithdrawalFeeWithdrawalRecord({
        ...context,
        log: log as EarnedWithdrawalFeesWithdrawnLog,
      });
      console.log(
        `[${log.eventName}] marketId=${record.event.marketId} recipient=${record.event.recipient} amount=${record.event.amount}`,
      );
      // Market is the only parent here, so the market-specific retry names
      // the wait precisely in logs ("MarketCreated", not the parents pair).
      await retryUntilMarketIndexed(
        () => persistWithdrawalFeeWithdrawalRecord(record),
        {
          label: log.eventName,
        },
      );
      return;
    }

    const buildConfigRecord =
      WITHDRAWAL_CONFIG_BUILDERS[
        log.eventName as keyof typeof WITHDRAWAL_CONFIG_BUILDERS
      ];
    if (buildConfigRecord) {
      const record = buildConfigRecord(context);
      console.log(
        `[${log.eventName}] previous=${record.event.previousValue} new=${record.event.newValue}`,
      );
      await persistWithdrawalConfigRecord(record);
      return;
    }

    const buildRecord =
      RECEIPT_WITHDRAWAL_BUILDERS[
        log.eventName as keyof typeof RECEIPT_WITHDRAWAL_BUILDERS
      ];
    if (!buildRecord) {
      throw new Error(
        `ReceiptWithdrawals watcher received unexpected event: ${log.eventName}`,
      );
    }

    const record = buildRecord(context);
    console.log(
      `[${log.eventName}] requestId=${record.event.requestId} receiptId=${record.event.receiptId} marketId=${record.event.marketId}`,
    );
    await retryUntilFeeParentsIndexed(
      () => persistReceiptWithdrawalRecord(record),
      {
        label: log.eventName!,
      },
    );
  },
  label: LABEL,
  subject: "pregrad manager",
  ...staticContractSet(() => config.contracts.pregradManager),
});

/** Catch-up sweep over withdrawal logs up to currentBlock. */
export const recoverReceiptWithdrawalEvents = watcher.recover;
/** Discovery loop + live subscription; returns a stop function. */
export const watchReceiptWithdrawalEvents = watcher.watch;
