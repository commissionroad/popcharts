import { pregradManagerAbi } from "@popcharts/protocol";
import { getAbiItem } from "viem";

import { config } from "src/config";
import { db, schema } from "src/db/client";
import {
  buildMarketCreatedRecords,
  type MarketCreatedLog,
} from "src/indexer/handlers/market-created";
import { persistMarketMetadataFromEventPayload } from "src/indexer/metadata/market-metadata";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getDefaultStartBlock } from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import {
  createDynamicAddressWatcher,
  staticContractSet,
} from "src/indexer/watchers/dynamic-address-watcher";

/**
 * Watches MarketCreated on the PregradManager — the root of every market's
 * indexed lifecycle. Each event seeds the markets projection and the
 * market-metadata store; the review, receipt, and settlement watchers all
 * wait on the row this one writes.
 */

const CURSOR_NAME = "MarketCreated";

const MARKET_CREATED_EVENT = getAbiItem({
  abi: pregradManagerAbi,
  name: "MarketCreated",
});

const watcher = createDynamicAddressWatcher({
  cursorName: CURSOR_NAME,
  events: [MARKET_CREATED_EVENT],
  fallbackStartBlock: (currentBlock) =>
    getDefaultStartBlock(CURSOR_NAME, currentBlock),
  handleLog: async (client, log) => {
    const marketCreatedLog = log as MarketCreatedLog;
    const marketId = marketCreatedLog.args.marketId?.toString() ?? "unknown";
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
      log: marketCreatedLog,
    });

    // Gated on the event insert like every other projection: watermark
    // replays are routine (each live creation is re-swept once), and an
    // unconditional upsert would stamp markets.updatedAt — which graduation
    // reads — on every replay of an old creation.
    const freshInsert = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.marketCreatedEvents)
        .values(records.event)
        .onConflictDoNothing()
        .returning({ id: schema.marketCreatedEvents.id });

      if (!inserted[0]) {
        return false;
      }

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
            openingProbabilityWad: records.market.openingProbabilityWad,
            resolutionTime: records.market.resolutionTime,
            yesNotBefore: records.market.yesNotBefore,
            updatedAt: new Date(),
          },
        });

      return true;
    });

    if (freshInsert) {
      await persistEventMetadata(records);
    }
  },
  label: "MarketCreated",
  subject: "pregrad manager",
  ...staticContractSet(() => config.contracts.pregradManager),
});

/** Catch-up sweep over MarketCreated logs up to currentBlock. */
export const recoverMarketCreatedEvents = watcher.recover;
/** Discovery loop + live subscription; returns a stop function. */
export const watchMarketCreatedEvents = watcher.watch;

async function persistEventMetadata(
  records: ReturnType<typeof buildMarketCreatedRecords>,
) {
  const metadata = records.event.metadata;

  try {
    if (!metadata) {
      throw new Error("MarketCreated records are missing metadata.");
    }

    await persistMarketMetadataFromEventPayload({
      chainId: records.market.chainId,
      metadataHash: records.market.metadataHash,
      metadata,
    });
  } catch (error) {
    console.warn(
      `[MarketCreated] metadata unavailable marketId=${records.market.marketId.toString()}: ${getErrorMessage(error)}`,
    );
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
