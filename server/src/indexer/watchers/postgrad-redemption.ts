import { completeSetBinaryMarketAbi } from "@popcharts/protocol";
import { getAbiItem } from "viem";

import { config } from "src/config";
import {
  buildPostgradRedemptionRecord,
  persistPostgradRedemptionRecord,
  type PostgradRedeemedLog,
  type PostgradRedemptionKind,
} from "src/indexer/handlers/postgrad-redemption";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import {
  getKnownPostgradMarket,
  refreshPostgradMarketRegistry,
} from "src/indexer/utils/postgrad-market-registry";
import { createDynamicAddressWatcher } from "src/indexer/watchers/dynamic-address-watcher";

/**
 * Watches Redeemed/CancelledRedeemed on every graduated
 * CompleteSetBinaryMarket so each redemption payout leaves its immutable
 * money-paper-trail row (docs/portfolio-data-design.md) — the collateral leg
 * of the redemption, complementing the token burn the outcome-token Transfer
 * watcher already captures.
 *
 * Markets are discovered from GraduationFinalized events. Unlike the
 * terminal-status events, one market emits many redemption logs, so the
 * cursor advances continuously. Subscription lifecycle and cursor discipline
 * live in the shared dynamic-address scaffolding.
 */

const REDEEMED_EVENT = getAbiItem({
  abi: completeSetBinaryMarketAbi,
  name: "Redeemed",
});
const CANCELLED_REDEEMED_EVENT = getAbiItem({
  abi: completeSetBinaryMarketAbi,
  name: "CancelledRedeemed",
});
const LABEL = "PostgradRedemption";

const watcher = createDynamicAddressWatcher({
  cursorName: "PostgradRedemption",
  events: [REDEEMED_EVENT, CANCELLED_REDEEMED_EVENT],
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
    const record = buildPostgradRedemptionRecord({
      blockTimestamp,
      config,
      contractId,
      kind,
      log: log as PostgradRedeemedLog,
      marketId: market.marketId,
    });

    await persistPostgradRedemptionRecord(record);
  },
  label: LABEL,
  refreshRegistry: refreshPostgradMarketRegistry,
  subject: "graduated postgrad market",
});

/** Catch-up sweep over every known market's redemption logs up to currentBlock. */
export const recoverPostgradRedemptionEvents = watcher.recover;
/** Live redemption subscription with market discovery; returns a stop function. */
export const watchPostgradRedemptionEvents = watcher.watch;

function kindForEventName(
  eventName: string | undefined,
): PostgradRedemptionKind | null {
  if (eventName === "Redeemed") {
    return "redeemed";
  }

  if (eventName === "CancelledRedeemed") {
    return "cancelled_redeemed";
  }

  return null;
}
