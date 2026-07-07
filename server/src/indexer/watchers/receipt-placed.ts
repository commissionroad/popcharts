import { parseAbiItem } from "viem";

import { config } from "src/config";
import type { BlockchainClient } from "src/blockchain/client";
import {
  buildReceiptPlacedRecord,
  persistReceiptPlacedRecord,
  type ReceiptPlacedLog,
} from "src/indexer/handlers/receipt-placed";
import { retryUntilMarketIndexed } from "src/indexer/handlers/market-projection";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import {
  getRecoveryStartBlock,
  updateLastProcessedBlock,
} from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";

const CURSOR_NAME = "ReceiptPlaced";

const RECEIPT_PLACED_EVENT = parseAbiItem(
  "event ReceiptPlaced(uint256 indexed receiptId, uint256 indexed marketId, address indexed owner, uint8 side, uint256 shares, uint256 cost, int256 rLow, int256 rHigh, uint64 sequence)",
);

type RecoveryOptions = {
  quiet?: boolean;
};

export async function processReceiptPlacedEvent(
  client: BlockchainClient,
  log: ReceiptPlacedLog,
) {
  const receiptId = log.args.receiptId?.toString() ?? "unknown";
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
    log,
  });

  // A receipt can race ahead of the independent MarketCreated watcher; wait
  // for the markets row rather than losing the counter updates. If retries
  // run out, the thrown error keeps the cursor behind so recovery replays it.
  await retryUntilMarketIndexed(() => persistReceiptPlacedRecord(record), {
    label: "ReceiptPlaced",
  });
  await updateLastProcessedBlock(
    config.contracts.pregradManager,
    CURSOR_NAME,
    record.blockNumber,
  );
}

export async function recoverReceiptPlacedEvents(
  client: BlockchainClient,
  currentBlock: bigint,
  options: RecoveryOptions = {},
) {
  const fromBlock = await getRecoveryStartBlock(
    config.contracts.pregradManager,
    CURSOR_NAME,
    currentBlock,
  );

  if (fromBlock >= currentBlock) {
    if (!options.quiet) {
      console.log("[ReceiptPlaced] No blocks to recover");
    }
    return;
  }

  if (!options.quiet) {
    console.log(
      `[ReceiptPlaced] Recovering events from block ${fromBlock} to ${currentBlock}`,
    );
  }

  const logs = await client.getLogs({
    address: config.contracts.pregradManager,
    event: RECEIPT_PLACED_EVENT,
    fromBlock,
    toBlock: currentBlock,
  });

  if (logs.length === 0) {
    if (!options.quiet) {
      console.log("[ReceiptPlaced] Found 0 historical events");
    }
    await updateLastProcessedBlock(
      config.contracts.pregradManager,
      CURSOR_NAME,
      currentBlock,
    );
    return;
  }

  console.log(`[ReceiptPlaced] Found ${logs.length} historical events`);

  for (const log of logs) {
    await processReceiptPlacedEvent(client, log as ReceiptPlacedLog);
  }
}

export function watchReceiptPlacedEvents(client: BlockchainClient) {
  console.log("[ReceiptPlaced] Starting real-time event watcher");

  return client.watchContractEvent({
    abi: [RECEIPT_PLACED_EVENT],
    address: config.contracts.pregradManager,
    eventName: "ReceiptPlaced",
    onError: (error) => {
      console.error("[ReceiptPlaced] Watch error:", error);
    },
    onLogs: async (logs) => {
      for (const log of logs) {
        await processReceiptPlacedEvent(client, log as ReceiptPlacedLog);
      }
    },
  });
}
