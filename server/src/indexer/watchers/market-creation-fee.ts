import { pregradManagerAbi } from "@popcharts/protocol";
import { getAbiItem } from "viem";

import { config } from "src/config";
import {
  buildMarketCreationFeeRecord,
  persistMarketCreationFeeRecord,
  type MarketCreationFeePaidLog,
} from "src/indexer/handlers/market-creation-fee";
import { retryUntilMarketIndexed } from "src/indexer/handlers/market-projection";
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
 * The row is foreign-keyed to `markets`, so — like the market-review watcher —
 * the persist waits for the `MarketCreated` watcher rather than assuming it
 * ran first. Both events come from the same transaction but different
 * watchers, so on the live path the fee log can arrive first. Nothing is lost
 * when it does: the wait ends in a ParkSweepError, which holds this address
 * below the log without advancing its cursor, and the next sweep retries it.
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

    // The fee log can outrun the independent MarketCreated watcher; wait for
    // the markets row rather than failing the money record. If retries run
    // out, the thrown MarketNotIndexedError parks the sweep so it replays.
    await retryUntilMarketIndexed(
      () => persistMarketCreationFeeRecord(record),
      {
        label: log.eventName!,
      },
    );
  },
  label: LABEL,
  subject: "pregrad manager",
  ...staticContractSet(() => config.contracts.pregradManager),
});

/** Catch-up sweep over creation-fee logs up to currentBlock. */
export const recoverMarketCreationFeeEvents = watcher.recover;
/** Discovery loop + live subscription; returns a stop function. */
export const watchMarketCreationFeeEvents = watcher.watch;
