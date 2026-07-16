import { parseAbiItem } from "viem";

import { config } from "src/config";
import {
  buildPostgradResolutionRecord,
  persistPostgradResolutionRecord,
  type PostgradMarketResolvedLog,
  type PostgradResolutionKind,
} from "src/indexer/handlers/postgrad-resolution";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import {
  getKnownPostgradMarket,
  refreshPostgradMarketRegistry,
} from "src/indexer/utils/postgrad-market-registry";
import { createDynamicAddressWatcher } from "src/indexer/watchers/dynamic-address-watcher";

/**
 * Watches MarketResolved/MarketCancelled on every graduated
 * CompleteSetBinaryMarket so markets.status reaches its terminal resolution
 * state no matter who resolved — the AI runner, an operator override, or a
 * trusted-creator self-resolve. The chain event is the canonical projector;
 * the resolution runner deliberately does not write markets.status itself.
 *
 * Markets are discovered from GraduationFinalized events; both events share
 * one cursor per market because a market emits at most one of them, ever.
 * Subscription lifecycle and cursor discipline live in the shared
 * dynamic-address scaffolding.
 */

const MARKET_RESOLVED_EVENT = parseAbiItem(
  "event MarketResolved(uint8 indexed side)",
);
const MARKET_CANCELLED_EVENT = parseAbiItem("event MarketCancelled()");
const LABEL = "PostgradResolution";

const watcher = createDynamicAddressWatcher({
  cursorName: "PostgradResolution",
  events: [MARKET_RESOLVED_EVENT, MARKET_CANCELLED_EVENT],
  getKnownContract: getKnownPostgradMarket,
  handleLog: async (client, log, market) => {
    const kind = kindForEventName(log.eventName);
    if (!kind) {
      console.warn(
        `[${LABEL}] Unrecognized event ${log.eventName ?? "unknown"} from ${market.address}; skipping`,
      );
      return;
    }

    console.log(
      `[${LABEL}] market=${market.address} marketId=${market.marketId} kind=${kind}`,
    );

    const contractId = await getOrCreateContractId(
      market.address,
      "CompleteSetBinaryMarket",
    );
    const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
    const record = buildPostgradResolutionRecord({
      blockTimestamp,
      config,
      contractId,
      kind,
      log: log as PostgradMarketResolvedLog,
      marketId: market.marketId,
    });

    await persistPostgradResolutionRecord(record);
  },
  label: LABEL,
  refreshRegistry: refreshPostgradMarketRegistry,
  subject: "graduated postgrad market",
});

/** Catch-up sweep over every known market's terminal events up to currentBlock. */
export const recoverPostgradResolutionEvents = watcher.recover;
/** Live terminal-event subscription with market discovery; returns a stop function. */
export const watchPostgradResolutionEvents = watcher.watch;

function kindForEventName(
  eventName: string | undefined,
): PostgradResolutionKind | null {
  if (eventName === "MarketResolved") {
    return "resolved";
  }

  if (eventName === "MarketCancelled") {
    return "cancelled";
  }

  return null;
}
