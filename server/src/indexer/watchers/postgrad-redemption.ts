import { completeSetBinaryMarketAbi } from "@popcharts/protocol";
import { getAbiItem } from "viem";

import type { BlockchainClient } from "src/blockchain/client";
import { config } from "src/config";
import {
  buildPostgradRedemptionRecord,
  persistPostgradRedemptionRecord,
  type PostgradRedeemedLog,
  type PostgradRedemptionKind,
} from "src/indexer/handlers/postgrad-redemption";
import { getBlockTimestamp } from "src/indexer/utils/block-timestamp";
import {
  getLastProcessedBlock,
  updateLastProcessedBlock,
} from "src/indexer/utils/block-tracker";
import { getOrCreateContractId } from "src/indexer/utils/contract-registry";
import {
  getKnownPostgradMarket,
  refreshPostgradMarketRegistry,
  type IndexedPostgradMarket,
} from "src/indexer/utils/postgrad-market-registry";

/**
 * Watches Redeemed/CancelledRedeemed on every graduated
 * CompleteSetBinaryMarket so each redemption payout leaves its immutable
 * money-paper-trail row (docs/portfolio-data-design.md) — the collateral leg
 * of the redemption, complementing the token burn the outcome-token Transfer
 * watcher already captures.
 *
 * Like the resolution watcher, the address set is dynamic: markets are
 * discovered from GraduationFinalized events, each runs behind its own
 * per-address cursor, and the live subscription is rebuilt on a discovery
 * interval when new markets graduate. Unlike the terminal-status events, one
 * market emits many redemption logs, so the cursor advances continuously.
 */

const REDEEMED_EVENT = getAbiItem({
  abi: completeSetBinaryMarketAbi,
  name: "Redeemed",
});
const CANCELLED_REDEEMED_EVENT = getAbiItem({
  abi: completeSetBinaryMarketAbi,
  name: "CancelledRedeemed",
});
const REDEMPTION_EVENTS = [REDEEMED_EVENT, CANCELLED_REDEEMED_EVENT];
const REDEMPTION_CURSOR = "PostgradRedemption";
const MARKET_DISCOVERY_INTERVAL_MS = 15_000;
const LABEL = "PostgradRedemption";

type RecoveryOptions = {
  quiet?: boolean;
};

type RedemptionLog = PostgradRedeemedLog & {
  eventName?: string;
};

export async function recoverPostgradRedemptionEvents(
  client: BlockchainClient,
  currentBlock: bigint,
  options: RecoveryOptions = {},
) {
  const markets = await refreshPostgradMarketRegistry();

  if (markets.length === 0) {
    if (!options.quiet) {
      console.log(`[${LABEL}] No graduated postgrad markets known; skipping`);
    }
    return;
  }

  for (const market of markets) {
    await recoverMarketRedemptionEvents(client, currentBlock, market, options);
  }
}

export function watchPostgradRedemptionEvents(client: BlockchainClient) {
  console.log(`[${LABEL}] Starting real-time event watcher`);

  let stopped = false;
  let synchronizing = false;
  let unwatch: () => void = () => {};
  let watchedMarketKey: string | null = null;

  // Rebuilds the subscription whenever the discovered market set changes. New
  // markets are backfilled from their cursor (or graduation block) before the
  // resubscribe so no redemption falls between discovery and the live watch.
  const synchronize = async () => {
    if (stopped || synchronizing) {
      return;
    }
    synchronizing = true;

    try {
      const markets = await refreshPostgradMarketRegistry();
      const marketKey = markets
        .map((market) => market.address)
        .sort()
        .join(",");

      if (marketKey === watchedMarketKey || stopped) {
        return;
      }

      // Subscribe BEFORE backfilling. Redemptions are many-per-market money
      // events: a log mined between a backfill's block snapshot and the
      // subscription install would be seen by neither path, and once a later
      // live log advanced the cursor past it the row would be lost for good.
      // Subscribing first can only double-deliver, and the (chain, tx, log)
      // dedupe makes replays no-ops.
      unwatch();
      unwatch =
        markets.length === 0
          ? () => {}
          : client.watchContractEvent({
              abi: REDEMPTION_EVENTS,
              address: markets.map((market) => market.address as `0x${string}`),
              onError: (error) => {
                console.error(`[${LABEL}] Watch error:`, error);
              },
              onLogs: async (logs) => {
                for (const log of logs) {
                  await processPostgradRedemptionEvent(
                    client,
                    log as RedemptionLog,
                  );
                }
              },
            });

      const currentBlock = await client.getBlockNumber();
      for (const market of markets) {
        await recoverMarketRedemptionEvents(client, currentBlock, market, {
          quiet: true,
        });
      }

      // Marked only after a full backfill: if recovery threw, the live
      // subscription stays up but the next discovery tick retries the sweep.
      watchedMarketKey = marketKey;

      if (markets.length > 0) {
        console.log(`[${LABEL}] Watching ${markets.length} postgrad market(s)`);
      }
    } finally {
      synchronizing = false;
    }
  };

  const logSynchronizeError = (error: unknown) => {
    console.error(`[${LABEL}] Market discovery error:`, error);
  };

  void synchronize().catch(logSynchronizeError);
  const discoveryInterval = setInterval(() => {
    void synchronize().catch(logSynchronizeError);
  }, MARKET_DISCOVERY_INTERVAL_MS);

  return () => {
    stopped = true;
    clearInterval(discoveryInterval);
    unwatch();
  };
}

export async function processPostgradRedemptionEvent(
  client: BlockchainClient,
  log: RedemptionLog,
) {
  const marketAddress = log.address.toLowerCase();
  let market = getKnownPostgradMarket(marketAddress);

  if (!market) {
    await refreshPostgradMarketRegistry();
    market = getKnownPostgradMarket(marketAddress);
  }

  // Only registry-discovered addresses are watched, so a miss is a stale
  // in-process cache at worst; leaving the cursor behind replays the log.
  if (!market) {
    console.warn(
      `[${LABEL}] Redemption event for unknown market ${marketAddress}; skipping`,
    );
    return;
  }

  const kind = kindForEventName(log.eventName);
  if (!kind) {
    console.warn(
      `[${LABEL}] Unrecognized event ${log.eventName ?? "unknown"} from ${marketAddress}; skipping`,
    );
    return;
  }

  console.log(
    `[${LABEL}] market=${marketAddress} marketId=${market.marketId} kind=${kind}`,
  );

  const contractId = await getOrCreateContractId(
    marketAddress,
    "CompleteSetBinaryMarket",
  );
  const blockTimestamp = await getBlockTimestamp(client, log.blockNumber!);
  const record = buildPostgradRedemptionRecord({
    blockTimestamp,
    config,
    contractId,
    kind,
    log,
    marketId: market.marketId,
  });

  await persistPostgradRedemptionRecord(record);
  // One block can hold several redemption logs, so advancing the cursor to
  // this log's block would skip that block's later logs if processing dies
  // between them (recovery restarts at cursor + 1). Trailing by one block
  // means a crash replays the whole block instead; the (chain, tx, log)
  // dedupe makes the replay idempotent, and the recovery sweep advances the
  // cursor to its snapshot once a full pass succeeds.
  await updateLastProcessedBlock(
    marketAddress,
    REDEMPTION_CURSOR,
    record.event.blockNumber - 1n,
  );
}

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

async function recoverMarketRedemptionEvents(
  client: BlockchainClient,
  currentBlock: bigint,
  market: IndexedPostgradMarket,
  options: RecoveryOptions,
) {
  const lastProcessed = await getLastProcessedBlock(
    market.address,
    REDEMPTION_CURSOR,
  );
  // First recovery starts at the market's graduation block: the contract
  // deploys in that transaction, so no redemption can be earlier.
  const fromBlock =
    lastProcessed !== null ? lastProcessed + 1n : market.startBlock;

  if (fromBlock > currentBlock) {
    if (!options.quiet) {
      console.log(`[${LABEL}] ${market.address}: no blocks to recover`);
    }
    return;
  }

  const logs = await client.getLogs({
    address: market.address as `0x${string}`,
    events: REDEMPTION_EVENTS,
    fromBlock,
    toBlock: currentBlock,
  });

  if (logs.length === 0) {
    if (!options.quiet) {
      console.log(`[${LABEL}] ${market.address}: found 0 historical events`);
    }
    await updateLastProcessedBlock(
      market.address,
      REDEMPTION_CURSOR,
      currentBlock,
    );
    return;
  }

  console.log(
    `[${LABEL}] ${market.address}: found ${logs.length} historical events`,
  );

  for (const log of logs) {
    await processPostgradRedemptionEvent(client, log as RedemptionLog);
  }

  // Per-log processing deliberately leaves the cursor one block behind (see
  // processPostgradRedemptionEvent); only a completed sweep may jump it to
  // the snapshot, guaranteeing every fetched log was persisted first.
  await updateLastProcessedBlock(
    market.address,
    REDEMPTION_CURSOR,
    currentBlock,
  );
}
