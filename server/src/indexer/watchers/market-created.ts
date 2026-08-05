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
import { logValueRequirer } from "src/indexer/utils/log-values";
import { marketStatusFromCode } from "src/indexer/utils/market-status-code";
import { readMarketStatusCode } from "src/indexer/utils/read-market-status";
import {
  createDynamicAddressWatcher,
  staticContractSet,
} from "src/indexer/watchers/dynamic-address-watcher";
import { recordLiveChange } from "src/change-feed/writer";

/**
 * Watches MarketCreated on the PregradManager — the root of every market's
 * indexed lifecycle. Each event seeds the markets projection and the
 * market-metadata store; the review, receipt, and settlement watchers all
 * wait on the row this one writes.
 */

const requireValue = logValueRequirer("MarketCreated log");

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
    const marketId = requireValue(marketCreatedLog.args.marketId, "marketId");
    console.log(`[MarketCreated] marketId=${marketId.toString()}`);

    const contractId = await getOrCreateContractId(
      config.contracts.pregradManager,
      "PregradManager",
    );
    const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
    // Read the status the contract actually holds rather than assuming the
    // one it mints markets in. Which status that is belongs to the deployed
    // contract (`UnderReview` today, `Active` after ADR 0022's P4 gate), so
    // assuming it here would couple this handler to a contract version and
    // mis-project every new market on the day that changed.
    const status = marketStatusFromCode(
      await readMarketStatusCode(client, marketId),
    );
    const records = buildMarketCreatedRecords({
      blockTimestamp,
      config,
      contractId,
      log: marketCreatedLog,
      status,
    });

    // Gated on the event insert like every other projection: watermark
    // replays are routine (each live creation is re-swept once), and an
    // unconditional upsert would stamp markets.updatedAt — which graduation
    // reads — on every replay of an old creation.
    await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.marketCreatedEvents)
        .values(records.event)
        .onConflictDoNothing()
        .returning({ id: schema.marketCreatedEvents.id });

      if (!inserted[0]) {
        return;
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

      // New market: appears on the discovery board and opens its own page.
      await recordLiveChange(tx, {
        sourceTable: "market_created_events",
        op: "insert",
        chainId: records.event.chainId,
        marketId: records.event.marketId,
        rowId: inserted[0].id,
        blockNumber: records.event.blockNumber,
        logIndex: records.event.logIndex,
      });
    });

    // Outside the freshInsert gate on purpose: the upsert is content-addressed
    // and idempotent, so the routine watermark replay of each creation
    // re-asserts its metadata — healing a row an earlier pass failed to write.
    // Since the event is the only metadata writer (ADR 0022 P6), the persist
    // classifies its own failures: unparseable payloads are logged and skipped,
    // database failures park this address for the next sweep.
    await persistMarketMetadataFromEventPayload({
      chainId: records.market.chainId,
      marketId: records.market.marketId,
      metadataHash: records.market.metadataHash,
      metadata: records.event.metadata,
    });
  },
  label: "MarketCreated",
  subject: "pregrad manager",
  ...staticContractSet(() => config.contracts.pregradManager),
});

/** Catch-up sweep over MarketCreated logs up to currentBlock. */
export const recoverMarketCreatedEvents = watcher.recover;
/** Discovery loop + live subscription; returns a stop function. */
export const watchMarketCreatedEvents = watcher.watch;
