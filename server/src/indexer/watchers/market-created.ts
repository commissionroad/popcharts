import { parseAbiItem } from "viem";

import { config } from "src/config";
import { db, schema } from "src/db/client";
import type { BlockchainClient } from "src/indexer/blockchain/client";
import {
  buildMarketCreatedRecords,
  type MarketCreatedLog,
} from "src/indexer/handlers/market-created";
import { persistMarketMetadataFromUri } from "src/indexer/metadata/market-metadata";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import {
  getRecoveryStartBlock,
  updateLastProcessedBlock,
} from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";

const CURSOR_NAME = "MarketCreated";

const MARKET_CREATED_EVENT = parseAbiItem(
  "event MarketCreated(uint256 indexed marketId, address indexed creator, bytes32 indexed metadataHash, string metadataURI, address collateral, uint256 openingProbabilityWad, uint256 liquidityParameter, uint256 graduationThreshold, uint64 graduationDeadline, uint64 resolutionTime, bool bypassAiResolution)",
);

type RecoveryOptions = {
  quiet?: boolean;
};

export async function processMarketCreatedEvent(
  client: BlockchainClient,
  log: MarketCreatedLog,
) {
  const marketId = log.args.marketId?.toString() ?? "unknown";
  console.log(`[MarketCreated] marketId=${marketId}`);

  const contractId = await getOrCreateContractId(
    config.contracts.pregradManager,
    "PregradManager",
  );
  const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
  const records = buildMarketCreatedRecords({
    blockTimestamp,
    config,
    contractId,
    log,
  });

  await persistMarketMetadataFromEvent(records);

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.marketCreatedEvents)
      .values(records.event)
      .onConflictDoNothing();

    await tx
      .insert(schema.markets)
      .values(records.market)
      .onConflictDoUpdate({
        target: [schema.markets.chainId, schema.markets.marketId],
        set: {
          collateral: records.market.collateral,
          contractId: records.market.contractId,
          createdBlockNumber: records.market.createdBlockNumber,
          createdBlockTimestamp: records.market.createdBlockTimestamp,
          createdLogIndex: records.market.createdLogIndex,
          createdTransactionHash: records.market.createdTransactionHash,
          creator: records.market.creator,
          graduationThreshold: records.market.graduationThreshold,
          graduationTime: records.market.graduationTime,
          liquidityParameter: records.market.liquidityParameter,
          metadataHash: records.market.metadataHash,
          metadataUri: records.market.metadataUri,
          openingProbabilityWad: records.market.openingProbabilityWad,
          resolutionTime: records.market.resolutionTime,
          updatedAt: new Date(),
        },
      });
  });

  await updateLastProcessedBlock(
    config.contracts.pregradManager,
    CURSOR_NAME,
    records.event.blockNumber,
  );
}

async function persistMarketMetadataFromEvent(
  records: ReturnType<typeof buildMarketCreatedRecords>,
) {
  const metadataUri = records.market.metadataUri;

  try {
    if (!metadataUri) {
      throw new Error("MarketCreated records are missing metadataURI.");
    }

    await persistMarketMetadataFromUri({
      chainId: records.market.chainId,
      metadataHash: records.market.metadataHash,
      metadataUri,
    });
  } catch (error) {
    console.warn(
      `[MarketCreated] metadata unavailable marketId=${records.market.marketId.toString()} uri=${metadataUri ?? "<missing>"}: ${getErrorMessage(error)}`,
    );
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function recoverMarketCreatedEvents(
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
      console.log("[MarketCreated] No blocks to recover");
    }
    return;
  }

  if (!options.quiet) {
    console.log(
      `[MarketCreated] Recovering events from block ${fromBlock} to ${currentBlock}`,
    );
  }

  const logs = await client.getLogs({
    address: config.contracts.pregradManager,
    event: MARKET_CREATED_EVENT,
    fromBlock,
    toBlock: currentBlock,
  });

  if (logs.length === 0) {
    if (!options.quiet) {
      console.log("[MarketCreated] Found 0 historical events");
    }
    await updateLastProcessedBlock(
      config.contracts.pregradManager,
      CURSOR_NAME,
      currentBlock,
    );
    return;
  }

  console.log(`[MarketCreated] Found ${logs.length} historical events`);

  for (const log of logs) {
    await processMarketCreatedEvent(client, log as MarketCreatedLog);
  }
}

export function watchMarketCreatedEvents(client: BlockchainClient) {
  console.log("[MarketCreated] Starting real-time event watcher");

  return client.watchContractEvent({
    abi: [MARKET_CREATED_EVENT],
    address: config.contracts.pregradManager,
    eventName: "MarketCreated",
    onError: (error) => {
      console.error("[MarketCreated] Watch error:", error);
    },
    onLogs: async (logs) => {
      for (const log of logs) {
        await processMarketCreatedEvent(client, log as MarketCreatedLog);
      }
    },
  });
}
