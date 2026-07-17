import { parseAbiItem } from "viem";

import { config } from "src/config";
import type { BlockchainClient } from "src/blockchain/client";
import {
  buildClearingRootSubmittedRecord,
  buildGraduatedReceiptClaimedRecord,
  buildGraduationFinalizedRecord,
  buildGraduationStartedRecord,
  buildMarketCancelledRecord,
  buildMarketRefundsAvailableRecord,
  buildRefundedReceiptClaimedRecord,
  persistClearingRootSubmittedRecord,
  persistGraduatedReceiptClaimedRecord,
  persistGraduationFinalizedRecord,
  persistGraduationStartedRecord,
  persistMarketCancelledRecord,
  persistMarketRefundsAvailableRecord,
  persistRefundedReceiptClaimedRecord,
  type ClearingRootSubmittedLog,
  type GraduatedReceiptClaimedLog,
  type GraduationFinalizedLog,
  type GraduationStartedLog,
  type MarketCancelledLog,
  type MarketRefundsAvailableLog,
  type RefundedReceiptClaimedLog,
} from "src/indexer/handlers/settlement";
import { retryUntilMarketIndexed } from "src/indexer/handlers/market-projection";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getDefaultStartBlock } from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import { registerVenuePoolsForGraduatedMarket } from "src/indexer/utils/venue-pool-registry";
import {
  createDynamicAddressWatcher,
  staticContractSet,
  type DynamicWatcherLog,
} from "src/indexer/watchers/dynamic-address-watcher";

// One cursor for all settlement events, replacing the pre-watermark per-event
// cursors (GraduationStarted … RefundedReceiptClaimed); their rows are
// orphaned and the first sweep re-walks from the deploy-block heuristic,
// which the deduped persists absorb. Single-cursor processing also delivers
// the events in true chain order, so a market's GraduationStarted always
// lands before its ClearingRootSubmitted.
const CURSOR_NAME = "Settlement";

const GRADUATION_STARTED_EVENT = parseAbiItem(
  "event GraduationStarted(uint256 indexed marketId, address indexed manager, uint256 receiptCount, uint256 totalEscrowed, int256 path, uint256 yesShares, uint256 noShares, uint64 graduationStartedAt, bytes32 snapshotHash)",
);
const CLEARING_ROOT_SUBMITTED_EVENT = parseAbiItem(
  "event ClearingRootSubmitted(uint256 indexed marketId, address indexed submitter, bytes32 indexed merkleRoot, bytes32 snapshotHash, uint256 matchedMarketCap, uint256 retainedCostTotal, uint256 refundTotal, uint256 completeSetCount, uint64 submittedAt, uint64 challengeDeadline)",
);
const GRADUATION_FINALIZED_EVENT = parseAbiItem(
  "event GraduationFinalized(uint256 indexed marketId, address indexed postgradAdapter, address indexed postgradMarket, uint256 completeSetCount, uint256 retainedCostTotal, uint256 refundTotal)",
);
const MARKET_REFUNDS_AVAILABLE_EVENT = parseAbiItem(
  "event MarketRefundsAvailable(uint256 indexed marketId, uint256 totalEscrowed)",
);
const MARKET_CANCELLED_EVENT = parseAbiItem(
  "event MarketCancelled(uint256 indexed marketId, uint256 totalEscrowed)",
);
const GRADUATED_RECEIPT_CLAIMED_EVENT = parseAbiItem(
  "event GraduatedReceiptClaimed(uint256 indexed receiptId, uint256 indexed marketId, address indexed owner, uint8 side, uint256 retainedShares, uint256 retainedCost, uint256 refund)",
);
const REFUNDED_RECEIPT_CLAIMED_EVENT = parseAbiItem(
  "event RefundedReceiptClaimed(uint256 indexed receiptId, uint256 indexed marketId, address indexed owner, uint256 refund)",
);

/**
 * Build + persist per event type; every persist dedupes on (chain, tx, log)
 * and guards its projection writes behind the insert, so watermark replays
 * are no-ops. The generic-log casts are safe because each entry only runs for
 * its own decoded eventName.
 */
const SETTLEMENT_HANDLERS: Record<
  string,
  (client: BlockchainClient, log: DynamicWatcherLog) => Promise<void>
> = {
  ClearingRootSubmitted: async (client, log) =>
    persistWithRetry(
      "ClearingRootSubmitted",
      buildClearingRootSubmittedRecord({
        ...(await buildInput(client, log)),
        log: log as ClearingRootSubmittedLog,
      }),
      persistClearingRootSubmittedRecord,
    ),
  GraduatedReceiptClaimed: async (client, log) =>
    persistWithRetry(
      "GraduatedReceiptClaimed",
      buildGraduatedReceiptClaimedRecord({
        ...(await buildInput(client, log)),
        log: log as GraduatedReceiptClaimedLog,
      }),
      persistGraduatedReceiptClaimedRecord,
    ),
  GraduationFinalized: async (client, log) => {
    const record = buildGraduationFinalizedRecord({
      ...(await buildInput(client, log)),
      log: log as GraduationFinalizedLog,
    });
    await persistWithRetry(
      "GraduationFinalized",
      record,
      persistGraduationFinalizedRecord,
    );

    // Best-effort: the venue order watcher re-derives this mapping lazily, so
    // a failure here (e.g. venue not deployed yet) must not park the sweep.
    try {
      await registerVenuePoolsForGraduatedMarket({
        client,
        marketId: record.marketId,
        postgradMarket: record.postgradMarket as `0x${string}`,
      });
    } catch (error) {
      console.warn(
        `[GraduationFinalized] Venue pool registration failed for market ${record.marketId}:`,
        error,
      );
    }
  },
  GraduationStarted: async (client, log) =>
    persistWithRetry(
      "GraduationStarted",
      buildGraduationStartedRecord({
        ...(await buildInput(client, log)),
        log: log as GraduationStartedLog,
      }),
      persistGraduationStartedRecord,
    ),
  MarketCancelled: async (client, log) =>
    persistWithRetry(
      "MarketCancelled",
      buildMarketCancelledRecord({
        ...(await buildInput(client, log)),
        log: log as MarketCancelledLog,
      }),
      persistMarketCancelledRecord,
    ),
  MarketRefundsAvailable: async (client, log) =>
    persistWithRetry(
      "MarketRefundsAvailable",
      buildMarketRefundsAvailableRecord({
        ...(await buildInput(client, log)),
        log: log as MarketRefundsAvailableLog,
      }),
      persistMarketRefundsAvailableRecord,
    ),
  RefundedReceiptClaimed: async (client, log) =>
    persistWithRetry(
      "RefundedReceiptClaimed",
      buildRefundedReceiptClaimedRecord({
        ...(await buildInput(client, log)),
        log: log as RefundedReceiptClaimedLog,
      }),
      persistRefundedReceiptClaimedRecord,
    ),
};

const watcher = createDynamicAddressWatcher({
  cursorName: CURSOR_NAME,
  events: [
    GRADUATION_STARTED_EVENT,
    CLEARING_ROOT_SUBMITTED_EVENT,
    GRADUATION_FINALIZED_EVENT,
    MARKET_REFUNDS_AVAILABLE_EVENT,
    MARKET_CANCELLED_EVENT,
    GRADUATED_RECEIPT_CLAIMED_EVENT,
    REFUNDED_RECEIPT_CLAIMED_EVENT,
  ],
  fallbackStartBlock: (currentBlock) =>
    getDefaultStartBlock(CURSOR_NAME, currentBlock),
  handleLog: async (client, log) => {
    const handle = log.eventName
      ? SETTLEMENT_HANDLERS[log.eventName]
      : undefined;

    if (!handle) {
      console.warn(
        `[Settlement] Unrecognized event ${log.eventName ?? "unknown"}; skipping`,
      );
      return;
    }

    const args = (log as DynamicWatcherLog & { args: Record<string, unknown> })
      .args;
    const subjectId = args.receiptId ?? args.marketId ?? "unknown";
    console.log(`[${log.eventName}] id=${String(subjectId)}`);

    await handle(client, log);
  },
  label: "Settlement",
  subject: "pregrad manager",
  ...staticContractSet(() => config.contracts.pregradManager),
});

export const recoverSettlementEvents = watcher.recover;
export const watchSettlementEvents = watcher.watch;

async function buildInput(client: BlockchainClient, log: DynamicWatcherLog) {
  const contractId = await getOrCreateContractId(
    config.contracts.pregradManager,
    "PregradManager",
  );
  const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);

  return { blockTimestamp, config, contractId };
}

/**
 * Settlement events can race ahead of the independent MarketCreated watcher;
 * wait for the markets row rather than losing the projection. If retries run
 * out, the thrown error parks the sweep so the event replays.
 */
function persistWithRetry<TRecord>(
  label: string,
  record: TRecord,
  persist: (record: TRecord) => Promise<void>,
) {
  return retryUntilMarketIndexed(() => persist(record), { label });
}
