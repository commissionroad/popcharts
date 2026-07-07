import { parseAbiItem } from "viem";

import { config } from "src/config";
import type { BlockchainClient } from "src/blockchain/client";
import {
  buildMarketReviewStatusUpdate,
  persistMarketReviewStatusUpdate,
  type MarketReviewLog,
  type MarketReviewStatus,
} from "src/indexer/handlers/market-review";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import {
  getRecoveryStartBlock,
  updateLastProcessedBlock,
} from "src/indexer/utils/block-tracker";

const MARKET_REVIEW_APPROVED_CURSOR_NAME = "MarketReviewApproved";
const MARKET_REVIEW_REJECTED_CURSOR_NAME = "MarketReviewRejected";

const MARKET_REVIEW_APPROVED_EVENT = parseAbiItem(
  "event MarketReviewApproved(uint256 indexed marketId, address indexed reviewer)",
);
const MARKET_REVIEW_REJECTED_EVENT = parseAbiItem(
  "event MarketReviewRejected(uint256 indexed marketId, address indexed reviewer)",
);

type RecoveryOptions = {
  quiet?: boolean;
};

export async function processMarketReviewEvent(
  client: BlockchainClient,
  log: MarketReviewLog,
  {
    cursorName,
    label,
    status,
  }: {
    cursorName: string;
    label: string;
    status: MarketReviewStatus;
  },
) {
  const marketId = log.args.marketId?.toString() ?? "unknown";
  console.log(`[${label}] marketId=${marketId}`);

  const blockNumber = requireBlockNumber(log);
  const blockTimestamp = await getBlockTimestamp(client, blockNumber);
  const update = buildMarketReviewStatusUpdate({
    blockTimestamp,
    config,
    log,
    status,
  });

  await persistMarketReviewStatusUpdate(update);
  await updateLastProcessedBlock(
    config.contracts.pregradManager,
    cursorName,
    blockNumber,
  );
}

export async function recoverMarketReviewEvents(
  client: BlockchainClient,
  currentBlock: bigint,
  options: RecoveryOptions = {},
) {
  await recoverMarketReviewEvent(client, currentBlock, {
    cursorName: MARKET_REVIEW_APPROVED_CURSOR_NAME,
    event: MARKET_REVIEW_APPROVED_EVENT,
    eventName: "MarketReviewApproved",
    label: "MarketReviewApproved",
    quiet: options.quiet,
    status: "bootstrap",
  });
  await recoverMarketReviewEvent(client, currentBlock, {
    cursorName: MARKET_REVIEW_REJECTED_CURSOR_NAME,
    event: MARKET_REVIEW_REJECTED_EVENT,
    eventName: "MarketReviewRejected",
    label: "MarketReviewRejected",
    quiet: options.quiet,
    status: "rejected",
  });
}

export function watchMarketReviewEvents(client: BlockchainClient) {
  console.log("[MarketReview] Starting real-time event watchers");

  const unwatchApproved = client.watchContractEvent({
    abi: [MARKET_REVIEW_APPROVED_EVENT],
    address: config.contracts.pregradManager,
    eventName: "MarketReviewApproved",
    onError: (error) => {
      console.error("[MarketReviewApproved] Watch error:", error);
    },
    onLogs: async (logs) => {
      for (const log of logs) {
        await processMarketReviewEvent(client, log as MarketReviewLog, {
          cursorName: MARKET_REVIEW_APPROVED_CURSOR_NAME,
          label: "MarketReviewApproved",
          status: "bootstrap",
        });
      }
    },
  });
  const unwatchRejected = client.watchContractEvent({
    abi: [MARKET_REVIEW_REJECTED_EVENT],
    address: config.contracts.pregradManager,
    eventName: "MarketReviewRejected",
    onError: (error) => {
      console.error("[MarketReviewRejected] Watch error:", error);
    },
    onLogs: async (logs) => {
      for (const log of logs) {
        await processMarketReviewEvent(client, log as MarketReviewLog, {
          cursorName: MARKET_REVIEW_REJECTED_CURSOR_NAME,
          label: "MarketReviewRejected",
          status: "rejected",
        });
      }
    },
  });

  return () => {
    unwatchApproved();
    unwatchRejected();
  };
}

async function recoverMarketReviewEvent(
  client: BlockchainClient,
  currentBlock: bigint,
  {
    cursorName,
    event,
    eventName,
    label,
    quiet,
    status,
  }: {
    cursorName: string;
    event:
      typeof MARKET_REVIEW_APPROVED_EVENT | typeof MARKET_REVIEW_REJECTED_EVENT;
    eventName: "MarketReviewApproved" | "MarketReviewRejected";
    label: string;
    quiet?: boolean;
    status: MarketReviewStatus;
  },
) {
  const fromBlock = await getRecoveryStartBlock(
    config.contracts.pregradManager,
    cursorName,
    currentBlock,
  );

  if (fromBlock >= currentBlock) {
    if (!quiet) {
      console.log(`[${label}] No blocks to recover`);
    }
    return;
  }

  if (!quiet) {
    console.log(
      `[${label}] Recovering events from block ${fromBlock} to ${currentBlock}`,
    );
  }

  const logs = await client.getLogs({
    address: config.contracts.pregradManager,
    event,
    fromBlock,
    toBlock: currentBlock,
  });

  if (logs.length === 0) {
    if (!quiet) {
      console.log(`[${label}] Found 0 historical events`);
    }
    await updateLastProcessedBlock(
      config.contracts.pregradManager,
      cursorName,
      currentBlock,
    );
    return;
  }

  console.log(`[${label}] Found ${logs.length} historical events`);

  for (const log of logs) {
    await processMarketReviewEvent(client, log as MarketReviewLog, {
      cursorName,
      label: eventName,
      status,
    });
  }
}

function requireBlockNumber(log: MarketReviewLog) {
  if (log.blockNumber === null || log.blockNumber === undefined) {
    throw new Error("Market review log is missing blockNumber.");
  }

  return log.blockNumber;
}
