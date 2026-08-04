import { pregradManagerAbi } from "@popcharts/protocol";
import { getAbiItem } from "viem";

import { config } from "src/config";
import {
  buildMarketCreationFeeRecord,
  persistMarketCreationFeeRecord,
  type MarketCreationFeePaidLog,
} from "src/indexer/handlers/market-creation-fee";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getDefaultStartBlock } from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import {
  createDynamicAddressWatcher,
  staticContractSet,
} from "src/indexer/watchers/dynamic-address-watcher";

/**
 * Watches MarketCreationFeePaid on the PregradManager so every creation fee
 * leaves an immutable market_creation_fee_events row
 * (docs/portfolio-data-design.md money invariant). The fee is collected
 * atomically inside `createMarket` and was previously indexed nowhere.
 *
 * The persist is a pure deduped append with no market projection, so — unlike
 * the market-review watcher — it does not wrap in `retryUntilMarketIndexed`.
 * The fee log and `MarketCreated` share a transaction but are consumed by
 * independent watchers; making the money record wait on the market row would
 * risk dropping the payment record to preserve an ordering nothing here needs.
 */

const CURSOR_NAME = "MarketCreationFee";
const LABEL = "MarketCreationFee";

const MARKET_CREATION_FEE_PAID_EVENT = getAbiItem({
  abi: pregradManagerAbi,
  name: "MarketCreationFeePaid",
});

const watcher = createDynamicAddressWatcher({
  cursorName: CURSOR_NAME,
  events: [MARKET_CREATION_FEE_PAID_EVENT],
  fallbackStartBlock: (currentBlock) =>
    getDefaultStartBlock(CURSOR_NAME, currentBlock),
  handleLog: async (client, log) => {
    const contractId = await getOrCreateContractId(
      config.contracts.pregradManager,
      "PregradManager",
    );
    const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
    const record = buildMarketCreationFeeRecord({
      blockTimestamp,
      config,
      contractId,
      log: log as MarketCreationFeePaidLog,
    });

    console.log(
      `[${log.eventName}] marketId=${record.event.marketId} creator=${record.event.creator} amount=${record.event.amount}`,
    );

    await persistMarketCreationFeeRecord(record);
  },
  label: LABEL,
  subject: "pregrad manager",
  ...staticContractSet(() => config.contracts.pregradManager),
});

/** Catch-up sweep over creation-fee logs up to currentBlock. */
export const recoverMarketCreationFeeEvents = watcher.recover;
/** Discovery loop + live subscription; returns a stop function. */
export const watchMarketCreationFeeEvents = watcher.watch;
