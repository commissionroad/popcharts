import { completeSetBinaryMarketAbi } from "@popcharts/protocol";
import { getAbiItem } from "viem";

import { config } from "src/config";
import {
  buildCompleteSetEventRecord,
  persistCompleteSetEventRecord,
  type CompleteSetsMergedLog,
  type CompleteSetsMintedLog,
} from "src/indexer/handlers/complete-set-events";
import {
  buildPostgradRedemptionRecord,
  persistPostgradRedemptionRecord,
  type PostgradCancelledRedeemedLog,
  type PostgradRedeemedLog,
} from "src/indexer/handlers/postgrad-redemption";
import {
  buildPostgradResolutionRecord,
  persistPostgradResolutionRecord,
  type PostgradMarketCancelledLog,
  type PostgradMarketResolvedLog,
} from "src/indexer/handlers/postgrad-resolution";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import {
  getKnownPostgradMarket,
  refreshPostgradMarketRegistry,
} from "src/indexer/utils/postgrad-market-registry";
import {
  createDynamicAddressWatcher,
  type DynamicWatcherLog,
} from "src/indexer/watchers/dynamic-address-watcher";

/**
 * Watches every graduated CompleteSetBinaryMarket for all of its money and
 * status events with one subscription and one cursor set:
 *
 * - MarketResolved/MarketCancelled flip markets.status to its terminal
 *   resolution state no matter who resolved — the AI runner, an operator
 *   override, or a trusted-creator self-resolve. The chain event is the
 *   canonical projector; the resolution runner deliberately does not write
 *   markets.status itself.
 * - Redeemed/CancelledRedeemed record each redemption payout's collateral leg
 *   as an immutable money-paper-trail row (docs/portfolio-data-design.md).
 * - CompleteSetsMinted/CompleteSetsMerged record collateral entering and
 *   leaving the market when users mint or merge YES+NO sets — the remaining
 *   collateral legs of the paper trail, and the missing input for portfolio
 *   PnL. The matching token mints/burns surface through the outcome-token
 *   Transfer watcher.
 *
 * Markets are discovered from GraduationFinalized events. Subscription
 * lifecycle and cursor discipline live in the shared dynamic-address
 * scaffolding.
 */

// One cursor for all postgrad-market events, replacing the pre-consolidation
// per-watcher cursors (PostgradResolution, PostgradRedemption); their rows are
// orphaned and the first sweep re-walks each market from its graduation start
// block in chunks, which the deduped persists absorb. Sweeps deliver a
// market's events in chain order; live subscription batches can interleave
// across event families, so handlers must not depend on cross-family commit
// order — and none do: every persist is a deduped append, and projection
// writes are guarded. The single watermark also means a persistently failing
// handler blocks the shared cursor for all six families (the same trade the
// settlement watcher makes); acceptable because persists are idempotent and
// failures surface loudly rather than silently skipping logs.
const CURSOR_NAME = "PostgradMarket";
const LABEL = "PostgradMarket";

const EVENTS = [
  getAbiItem({ abi: completeSetBinaryMarketAbi, name: "MarketResolved" }),
  getAbiItem({ abi: completeSetBinaryMarketAbi, name: "MarketCancelled" }),
  getAbiItem({ abi: completeSetBinaryMarketAbi, name: "Redeemed" }),
  getAbiItem({ abi: completeSetBinaryMarketAbi, name: "CancelledRedeemed" }),
  getAbiItem({ abi: completeSetBinaryMarketAbi, name: "CompleteSetsMinted" }),
  getAbiItem({ abi: completeSetBinaryMarketAbi, name: "CompleteSetsMerged" }),
];

/** Per-log context shared by every handler: registry + chain lookups. */
type HandlerInput = {
  blockTimestamp: Date;
  config: typeof config;
  contractId: number;
  marketId: bigint;
};

/**
 * Build + persist per event type; every persist dedupes on (chain, tx, log)
 * and guards any projection write behind the insert, so watermark replays are
 * no-ops. The generic-log casts are safe because each entry only runs for its
 * own decoded eventName.
 */
const POSTGRAD_MARKET_HANDLERS: Record<
  string,
  (input: HandlerInput, log: DynamicWatcherLog) => Promise<void>
> = {
  CancelledRedeemed: (input, log) =>
    persistPostgradRedemptionRecord(
      buildPostgradRedemptionRecord({
        ...input,
        kind: "cancelled_redeemed",
        log: log as PostgradCancelledRedeemedLog,
      }),
    ),
  CompleteSetsMerged: (input, log) =>
    persistCompleteSetEventRecord(
      buildCompleteSetEventRecord({
        ...input,
        kind: "merged",
        log: log as CompleteSetsMergedLog,
      }),
    ),
  CompleteSetsMinted: (input, log) =>
    persistCompleteSetEventRecord(
      buildCompleteSetEventRecord({
        ...input,
        kind: "minted",
        log: log as CompleteSetsMintedLog,
      }),
    ),
  MarketCancelled: (input, log) =>
    persistPostgradResolutionRecord(
      buildPostgradResolutionRecord({
        ...input,
        kind: "cancelled",
        log: log as PostgradMarketCancelledLog,
      }),
    ),
  MarketResolved: (input, log) =>
    persistPostgradResolutionRecord(
      buildPostgradResolutionRecord({
        ...input,
        kind: "resolved",
        log: log as PostgradMarketResolvedLog,
      }),
    ),
  Redeemed: (input, log) =>
    persistPostgradRedemptionRecord(
      buildPostgradRedemptionRecord({
        ...input,
        kind: "redeemed",
        log: log as PostgradRedeemedLog,
      }),
    ),
};

const watcher = createDynamicAddressWatcher({
  cursorName: CURSOR_NAME,
  events: EVENTS,
  getKnownContract: getKnownPostgradMarket,
  handleLog: async (client, log, market) => {
    const handle = log.eventName
      ? POSTGRAD_MARKET_HANDLERS[log.eventName]
      : undefined;

    if (!handle) {
      console.warn(
        `[${LABEL}] Unrecognized event ${log.eventName ?? "unknown"} from ${market.address}; skipping`,
      );
      return;
    }

    console.log(
      `[${LABEL}] market=${market.address} marketId=${market.marketId} event=${log.eventName}`,
    );

    const contractId = await getOrCreateContractId(
      market.address,
      "CompleteSetBinaryMarket",
    );
    const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);

    await handle(
      { blockTimestamp, config, contractId, marketId: market.marketId },
      log,
    );
  },
  label: LABEL,
  refreshRegistry: refreshPostgradMarketRegistry,
  subject: "graduated postgrad market",
});

/** Catch-up sweep over every known market's logs up to currentBlock. */
export const recoverPostgradMarketEvents = watcher.recover;
/** Live postgrad-market subscription with market discovery; returns a stop function. */
export const watchPostgradMarketEvents = watcher.watch;
