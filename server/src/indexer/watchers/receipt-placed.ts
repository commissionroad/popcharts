import { parseAbiItem } from "viem";

import { config } from "src/config";
import {
  buildReceiptPlacedRecord,
  persistReceiptPlacedRecord,
  type ReceiptPlacedLog,
} from "src/indexer/handlers/receipt-placed";
import { retryUntilMarketIndexed } from "src/indexer/handlers/market-projection";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getDefaultStartBlock } from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import {
  createDynamicAddressWatcher,
  staticContractSet,
} from "src/indexer/watchers/dynamic-address-watcher";

const CURSOR_NAME = "ReceiptPlaced";

const RECEIPT_PLACED_EVENT = parseAbiItem(
  "event ReceiptPlaced(uint256 indexed receiptId, uint256 indexed marketId, address indexed owner, uint8 side, uint256 shares, uint256 cost, int256 rLow, int256 rHigh, uint64 sequence)",
);

const watcher = createDynamicAddressWatcher({
  cursorName: CURSOR_NAME,
  events: [RECEIPT_PLACED_EVENT],
  fallbackStartBlock: (currentBlock) =>
    getDefaultStartBlock(CURSOR_NAME, currentBlock),
  handleLog: async (client, log) => {
    const receiptLog = log as ReceiptPlacedLog;
    const receiptId = receiptLog.args.receiptId?.toString() ?? "unknown";
    console.log(`[ReceiptPlaced] receiptId=${receiptId}`);

    const contractId = await getOrCreateContractId(
      config.contracts.pregradManager,
      "PregradManager",
    );
    const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
    const record = buildReceiptPlacedRecord({
      blockTimestamp,
      config,
      contractId,
      log: receiptLog,
    });

    // A receipt can race ahead of the independent MarketCreated watcher; wait
    // for the markets row rather than losing the counter updates. If retries
    // run out, the thrown error parks the sweep so the event replays.
    await retryUntilMarketIndexed(() => persistReceiptPlacedRecord(record), {
      label: "ReceiptPlaced",
    });
  },
  label: "ReceiptPlaced",
  subject: "pregrad manager",
  ...staticContractSet(() => config.contracts.pregradManager),
});

/** Catch-up sweep over ReceiptPlaced logs up to currentBlock. */
export const recoverReceiptPlacedEvents = watcher.recover;
/** Discovery loop + live subscription; returns a stop function. */
export const watchReceiptPlacedEvents = watcher.watch;
