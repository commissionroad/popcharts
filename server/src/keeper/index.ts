import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbiItem,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { readDevPrivateKey } from "src/api/services/local-dev-chain";
import { postgradVenueConfigured } from "src/api/services/postgrad-venue";
import { config, ZERO_ADDRESS } from "src/config";

import {
  discoverPregradMarkets,
  discoverTrackedMarkets,
  type TrackedMarket,
  type TrackedPregradMarket,
} from "./discovery";
import { runGraduationPass, runMarketPass } from "./keeper";
import { createSingleFlightScheduler } from "./scheduler";

/**
 * Venue keeper: graduates pregrad markets the moment they earn it, then
 * keeps every graduated market's YES/NO pools economically consistent and
 * its maker orders filling.
 *
 * Discovery is database-driven — bootstrap markets and graduated markets
 * come from the indexer's projections (plus the env-configured demo market),
 * so a market is watched from creation and tracked as a venue the moment it
 * graduates. Reaction is trade-driven — a pregrad ReceiptPlaced schedules a
 * graduation check, and a PoolManager Swap or an order-manager
 * DeferredExecutionStored on a tracked pool schedules a maintenance pass,
 * coalesced to one in-flight pass per market. A periodic sweep backstops
 * anything a watcher misses.
 */

const SWAP_EVENT = parseAbiItem(
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
);
const DEFERRED_STORED_EVENT = parseAbiItem(
  "event DeferredExecutionStored(bytes32 indexed executionId, bytes32 indexed poolId, int24 fromTick, int24 toTick, uint256 orderCount)",
);
const RECEIPT_PLACED_EVENT = parseAbiItem(
  "event ReceiptPlaced(uint256 indexed receiptId, uint256 indexed marketId, address indexed owner, uint8 side, uint256 shares, uint256 cost, int256 rLow, int256 rHigh, uint64 sequence)",
);

const sweepIntervalMs = Number.parseInt(
  process.env.POPCHARTS_KEEPER_INTERVAL_MS ?? "30000",
  10,
);
const discoveryIntervalMs = Number.parseInt(
  process.env.POPCHARTS_KEEPER_DISCOVERY_MS ?? "15000",
  10,
);
// Automatic graduation drives the same dev settlement flow as the graduate
// button, so it exists exactly where that flow does: dev tools on the local
// network. POPCHARTS_KEEPER_AUTO_GRADUATE=false opts out.
const autoGraduateEnabled =
  config.devToolsEnabled &&
  config.name === "local" &&
  process.env.POPCHARTS_KEEPER_AUTO_GRADUATE !== "false";

if (
  !postgradVenueConfigured() ||
  config.contracts.swapRouter === ZERO_ADDRESS
) {
  console.error(
    "[Keeper] Postgrad venue contracts are not configured " +
      "(pool manager, state view, tick bounds, order manager, hook, swap router); exiting.",
  );
  process.exit(1);
}

const publicClient = createPublicClient({
  chain: config.chain,
  transport: http(config.rpcHttpUrl),
});
const walletClient = createWalletClient({
  account: privateKeyToAccount(readDevPrivateKey()),
  chain: config.chain,
  transport: http(config.rpcHttpUrl),
});
const clients = { publicClient, walletClient };
const scheduler = createSingleFlightScheduler({
  onError: (key, error) => {
    console.error(`[Keeper] Pass failed for ${key}:`, error);
  },
});

let trackedByPoolId = new Map<string, TrackedMarket>();
let trackedMarkets: TrackedMarket[] = [];
let pregradByMarketId = new Map<string, TrackedPregradMarket>();
let pregradMarkets: TrackedPregradMarket[] = [];

function schedulePass(market: TrackedMarket, reason: string) {
  if (reason !== "periodic sweep") {
    console.log(`[Keeper] ${market.label}: pass scheduled (${reason}).`);
  }
  void scheduler.schedule(market.key, () =>
    runMarketPass({ clients, market }).then((result) => {
      if (result.action === "hold" && result.resolvedDeferred === 0) {
        return;
      }
      console.log(
        `[Keeper] ${market.label}: pass complete ` +
          `(action ${result.action}, deferred resolved ${result.resolvedDeferred}).`,
      );
    }),
  );
}

function scheduleGraduationPass(market: TrackedPregradMarket, reason: string) {
  if (reason !== "periodic sweep") {
    console.log(
      `[Keeper] ${market.label}: graduation check scheduled (${reason}).`,
    );
  }
  void scheduler.schedule(market.key, () =>
    runGraduationPass({ market }).then((outcome) => {
      if (outcome === "graduated") {
        // Track the fresh venue (and stop watching the pregrad side)
        // without waiting for the next discovery interval.
        void refreshDiscovery();
      }
    }),
  );
}

async function refreshDiscovery(initial = false) {
  try {
    const markets = await discoverTrackedMarkets({ publicClient });
    const nextByPoolId = new Map<string, TrackedMarket>();

    for (const market of markets) {
      nextByPoolId.set(market.manifest.pools.yes.poolId.toLowerCase(), market);
      nextByPoolId.set(market.manifest.pools.no.poolId.toLowerCase(), market);
    }

    const previousKeys = new Set(trackedMarkets.map((market) => market.key));
    trackedMarkets = markets;
    trackedByPoolId = nextByPoolId;

    for (const market of markets) {
      if (initial || !previousKeys.has(market.key)) {
        schedulePass(market, initial ? "startup" : "newly tracked");
      }
    }

    if (autoGraduateEnabled) {
      const pregrads = await discoverPregradMarkets();
      const previousPregradKeys = new Set(
        pregradMarkets.map((market) => market.key),
      );
      pregradMarkets = pregrads;
      pregradByMarketId = new Map(
        pregrads.map((market) => [market.marketId.toString(), market]),
      );

      for (const market of pregrads) {
        if (initial || !previousPregradKeys.has(market.key)) {
          scheduleGraduationPass(market, initial ? "startup" : "newly tracked");
        }
      }
    }
  } catch (error) {
    console.error("[Keeper] Discovery failed:", error);
  }
}

function watchVenueEvents() {
  publicClient.watchEvent({
    address: config.contracts.poolManager,
    event: SWAP_EVENT,
    onError: (error) => console.error("[Keeper] Swap watcher error:", error),
    onLogs: (logs) => {
      for (const log of logs) {
        const market = trackedByPoolId.get((log.args.id ?? "").toLowerCase());

        if (market) {
          schedulePass(market, "swap observed");
        }
      }
    },
  });
  publicClient.watchEvent({
    address: config.contracts.orderManager,
    event: DEFERRED_STORED_EVENT,
    onError: (error) =>
      console.error("[Keeper] Deferred watcher error:", error),
    onLogs: (logs) => {
      for (const log of logs) {
        const market = trackedByPoolId.get(
          (log.args.poolId ?? "").toLowerCase(),
        );

        if (market) {
          schedulePass(market, "deferred execution stored");
        }
      }
    },
  });
}

function watchPregradEvents() {
  publicClient.watchEvent({
    address: config.contracts.pregradManager,
    event: RECEIPT_PLACED_EVENT,
    onError: (error) => console.error("[Keeper] Receipt watcher error:", error),
    onLogs: (logs) => {
      for (const log of logs) {
        const market = pregradByMarketId.get(
          (log.args.marketId ?? 0n).toString(),
        );

        if (market) {
          scheduleGraduationPass(market, "receipt placed");
        }
      }
    },
  });
}

console.log(
  `[Keeper] Starting venue keeper on ${config.name} ` +
    `(pool manager ${config.contracts.poolManager}, auto-graduate ` +
    `${autoGraduateEnabled ? "on" : "off"}).`,
);
await refreshDiscovery(true);
watchVenueEvents();

if (autoGraduateEnabled) {
  watchPregradEvents();
}

setInterval(() => void refreshDiscovery(), discoveryIntervalMs);
setInterval(() => {
  for (const market of trackedMarkets) {
    schedulePass(market, "periodic sweep");
  }
  for (const market of pregradMarkets) {
    scheduleGraduationPass(market, "periodic sweep");
  }
}, sweepIntervalMs);
console.log(
  `[Keeper] Tracking ${trackedMarkets.length} venue market(s) and ` +
    `${pregradMarkets.length} pregrad market(s); sweep every ` +
    `${sweepIntervalMs}ms, discovery every ${discoveryIntervalMs}ms.`,
);
