import { pregradManagerAbi } from "@popcharts/protocol";
import { getAbiItem } from "viem";

import { config } from "src/config";
import {
  buildMarketReviewStatusUpdate,
  persistMarketReviewStatusUpdate,
  type MarketReviewLog,
  type MarketReviewStatus,
} from "src/indexer/handlers/market-review";
import { retryUntilMarketIndexed } from "src/indexer/handlers/market-projection";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getDefaultStartBlock } from "src/indexer/utils/block-tracker";
import {
  createDynamicAddressWatcher,
  staticContractSet,
} from "src/indexer/watchers/dynamic-address-watcher";

// Replaces the pre-watermark per-event cursors (MarketReviewApproved,
// MarketReviewRejected); their rows are orphaned and the first sweep re-walks
// from the deploy-block heuristic, which the status-guarded persist absorbs.
const CURSOR_NAME = "MarketReview";

const MARKET_REVIEW_APPROVED_EVENT = getAbiItem({
  abi: pregradManagerAbi,
  name: "MarketReviewApproved",
});
const MARKET_REVIEW_REJECTED_EVENT = getAbiItem({
  abi: pregradManagerAbi,
  name: "MarketReviewRejected",
});

const STATUS_BY_EVENT: Record<string, MarketReviewStatus> = {
  MarketReviewApproved: "bootstrap",
  MarketReviewRejected: "rejected",
};

const watcher = createDynamicAddressWatcher({
  cursorName: CURSOR_NAME,
  events: [MARKET_REVIEW_APPROVED_EVENT, MARKET_REVIEW_REJECTED_EVENT],
  fallbackStartBlock: (currentBlock) =>
    getDefaultStartBlock(CURSOR_NAME, currentBlock),
  handleLog: async (client, log) => {
    const reviewLog = log as MarketReviewLog & { eventName?: string };
    const status = log.eventName ? STATUS_BY_EVENT[log.eventName] : undefined;

    if (!status) {
      console.warn(
        `[MarketReview] Unrecognized event ${log.eventName ?? "unknown"}; skipping`,
      );
      return;
    }

    const marketId = reviewLog.args.marketId?.toString() ?? "unknown";
    console.log(`[${log.eventName}] marketId=${marketId}`);

    const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
    const update = buildMarketReviewStatusUpdate({
      blockTimestamp,
      config,
      log: reviewLog,
      status,
    });

    // A review event can race ahead of the independent MarketCreated watcher;
    // wait for the markets row rather than losing the status change. If
    // retries run out, the thrown error parks the sweep so the event replays.
    await retryUntilMarketIndexed(
      () => persistMarketReviewStatusUpdate(update),
      { label: log.eventName! },
    );
  },
  label: "MarketReview",
  subject: "pregrad manager",
  ...staticContractSet(() => config.contracts.pregradManager),
});

/** Catch-up sweep over review approval/rejection logs up to currentBlock. */
export const recoverMarketReviewEvents = watcher.recover;
/** Discovery loop + live subscription; returns a stop function. */
export const watchMarketReviewEvents = watcher.watch;
