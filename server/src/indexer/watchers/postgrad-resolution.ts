import { parseAbiItem } from "viem";

import type { BlockchainClient } from "src/blockchain/client";
import { config } from "src/config";
import {
  buildPostgradResolutionRecord,
  persistPostgradResolutionRecord,
  type PostgradMarketResolvedLog,
  type PostgradResolutionKind,
} from "src/indexer/handlers/postgrad-resolution";
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
 * Watches MarketResolved/MarketCancelled on every graduated
 * CompleteSetBinaryMarket so markets.status reaches its terminal resolution
 * state no matter who resolved — the AI runner, an operator override, or a
 * trusted-creator self-resolve. The chain event is the canonical projector;
 * the resolution runner deliberately does not write markets.status itself.
 *
 * Like the outcome-token watcher, the address set is dynamic: markets are
 * discovered from GraduationFinalized events, each runs behind its own
 * per-address cursor, and the live subscription is rebuilt on a discovery
 * interval when new markets graduate. Both events share one cursor per market
 * because a market emits at most one of them, ever.
 */

const MARKET_RESOLVED_EVENT = parseAbiItem(
  "event MarketResolved(uint8 indexed side)",
);
const MARKET_CANCELLED_EVENT = parseAbiItem("event MarketCancelled()");
const RESOLUTION_EVENTS = [MARKET_RESOLVED_EVENT, MARKET_CANCELLED_EVENT];
const RESOLUTION_CURSOR = "PostgradResolution";
const MARKET_DISCOVERY_INTERVAL_MS = 15_000;
const LABEL = "PostgradResolution";

type RecoveryOptions = {
  quiet?: boolean;
};

type ResolutionLog = PostgradMarketResolvedLog & {
  eventName?: string;
};

export async function recoverPostgradResolutionEvents(
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
    await recoverMarketResolutionEvents(client, currentBlock, market, options);
  }
}

export function watchPostgradResolutionEvents(client: BlockchainClient) {
  console.log(`[${LABEL}] Starting real-time event watcher`);

  let stopped = false;
  let synchronizing = false;
  let unwatch: () => void = () => {};
  let watchedMarketKey: string | null = null;

  // Rebuilds the subscription whenever the discovered market set changes. New
  // markets are backfilled from their cursor (or graduation block) before the
  // resubscribe so no terminal event falls between discovery and the live watch.
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

      if (marketKey === watchedMarketKey) {
        return;
      }

      const currentBlock = await client.getBlockNumber();
      for (const market of markets) {
        await recoverMarketResolutionEvents(client, currentBlock, market, {
          quiet: true,
        });
      }

      if (stopped) {
        return;
      }

      unwatch();
      unwatch =
        markets.length === 0
          ? () => {}
          : client.watchContractEvent({
              abi: RESOLUTION_EVENTS,
              address: markets.map((market) => market.address as `0x${string}`),
              onError: (error) => {
                console.error(`[${LABEL}] Watch error:`, error);
              },
              onLogs: async (logs) => {
                for (const log of logs) {
                  await processPostgradResolutionEvent(
                    client,
                    log as ResolutionLog,
                  );
                }
              },
            });
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

export async function processPostgradResolutionEvent(
  client: BlockchainClient,
  log: ResolutionLog,
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
      `[${LABEL}] Terminal event for unknown market ${marketAddress}; skipping`,
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
  const record = buildPostgradResolutionRecord({
    blockTimestamp,
    config,
    contractId,
    kind,
    log,
    marketId: market.marketId,
  });

  await persistPostgradResolutionRecord(record);
  await updateLastProcessedBlock(
    marketAddress,
    RESOLUTION_CURSOR,
    record.event.blockNumber,
  );
}

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

async function recoverMarketResolutionEvents(
  client: BlockchainClient,
  currentBlock: bigint,
  market: IndexedPostgradMarket,
  options: RecoveryOptions,
) {
  const lastProcessed = await getLastProcessedBlock(
    market.address,
    RESOLUTION_CURSOR,
  );
  // First recovery starts at the market's graduation block: the contract
  // deploys in that transaction, so no terminal event can be earlier.
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
    events: RESOLUTION_EVENTS,
    fromBlock,
    toBlock: currentBlock,
  });

  if (logs.length === 0) {
    if (!options.quiet) {
      console.log(`[${LABEL}] ${market.address}: found 0 historical events`);
    }
    await updateLastProcessedBlock(
      market.address,
      RESOLUTION_CURSOR,
      currentBlock,
    );
    return;
  }

  console.log(
    `[${LABEL}] ${market.address}: found ${logs.length} historical events`,
  );

  for (const log of logs) {
    await processPostgradResolutionEvent(client, log as ResolutionLog);
  }
}
