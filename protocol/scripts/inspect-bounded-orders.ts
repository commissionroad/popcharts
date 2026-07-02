import hre, { network } from "hardhat";
import { formatUnits, type Address, type Hex, type PublicClient } from "viem";

import { resolveDeploymentChainProfile } from "./shared/chain/resolveDeploymentChainProfile.js";
import { assertDeployedBytecode } from "./shared/contract/assertDeployedBytecode.js";
import { assertHardhatNetwork } from "./shared/hardhat/assertHardhatNetwork.js";
import { COMPLETE_SET_KEEPER_POLICY } from "./shared/market/completeSetKeeperPolicy.js";
import {
  detectBoundedOrderAnomalies,
  type BoundedOrderAnomaly,
  type BoundedPoolInspection,
} from "./shared/market/detectBoundedOrderAnomalies.js";
import { findPendingDeferredExecutions } from "./shared/market/findPendingDeferredExecutions.js";
import { readBoundedOrder } from "./shared/market/readBoundedOrder.js";
import {
  readCompleteSetMarketManifest,
  type CompleteSetMarketManifestData,
  type CompleteSetMarketPool,
} from "./shared/market/readCompleteSetMarketManifest.js";
import { readPoolDisplayPrice } from "./shared/market/readPoolDisplayPrice.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const ORDER_LIFECYCLE_EVENTS_ABI = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "poolId", type: "bytes32" },
      { indexed: true, name: "orderId", type: "uint32" },
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "zeroForOne", type: "bool" },
      { indexed: false, name: "tickLower", type: "int24" },
      { indexed: false, name: "tickUpper", type: "int24" },
      { indexed: false, name: "liquidity", type: "uint128" },
      { indexed: false, name: "amountIn", type: "uint256" },
    ],
    name: "OrderCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "poolId", type: "bytes32" },
      { indexed: true, name: "orderId", type: "uint32" },
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "amount0", type: "uint256" },
      { indexed: false, name: "amount1", type: "uint256" },
    ],
    name: "OrderCancelled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "poolId", type: "bytes32" },
      { indexed: true, name: "orderId", type: "uint32" },
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "amount0", type: "uint256" },
      { indexed: false, name: "amount1", type: "uint256" },
    ],
    name: "OrderFilled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "poolId", type: "bytes32" },
      { indexed: true, name: "orderId", type: "uint32" },
      { indexed: true, name: "owner", type: "address" },
      { indexed: false, name: "amount0", type: "uint256" },
      { indexed: false, name: "amount1", type: "uint256" },
      { indexed: false, name: "tickLower", type: "int24" },
      { indexed: false, name: "tickUpper", type: "int24" },
      { indexed: false, name: "indexedTick", type: "int24" },
      { indexed: false, name: "remainingLiquidity", type: "uint128" },
    ],
    name: "OrderPartiallyFilled",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "poolId", type: "bytes32" },
      { indexed: true, name: "orderId", type: "uint32" },
      { indexed: false, name: "thresholdTick", type: "int24" },
    ],
    name: "OrderRequeued",
    type: "event",
  },
] as const;

const POOL_WHITELISTED_ABI = [
  {
    inputs: [{ name: "poolId", type: "bytes32" }],
    name: "poolWhitelisted",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const GET_POOL_TICK_BOUNDS_ABI = [
  {
    inputs: [{ name: "poolId", type: "bytes32" }],
    name: "getPoolTickBounds",
    outputs: [
      { name: "configured", type: "bool" },
      { name: "lowerTick", type: "int24" },
      { name: "upperTick", type: "int24" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

/**
 * Read-only stuck-order and market inspection (protocol MVP tracker item 4):
 * replays the order manager's order lifecycle events for both outcome pools,
 * reads back live order state, compares current pool ticks against open order
 * ranges, lists pending deferred executions with their age, and reports the
 * tick-bounds and whitelist configuration. Anomalies are flagged through
 * detectBoundedOrderAnomalies; POPCHARTS_INSPECT_STRICT=true turns any
 * anomaly into a nonzero exit.
 *
 * Env vars: POPCHARTS_INSPECT_FROM_BLOCK (defaults to the market manifest's
 * blockNumber), POPCHARTS_INSPECT_STALE_ORDER_BLOCKS,
 * POPCHARTS_INSPECT_STALE_DEFERRED_BLOCKS, POPCHARTS_INSPECT_STRICT.
 */
async function main() {
  const connection = await network.create();
  const profile = resolveDeploymentChainProfile(connection.networkName);
  const publicClient = await connection.viem.getPublicClient();
  const chainId = await assertHardhatNetwork({
    expectedChainId: profile.chainId,
    expectedNetworkName: profile.networkName,
    networkName: connection.networkName,
    publicClient,
  });
  const { manifest, manifestPath } = await readCompleteSetMarketManifest({
    chainEnv: profile.chainEnv,
    env: process.env,
    expectedChainId: chainId,
    protocolRoot: hre.config.paths.root,
  });

  console.log("Pop Charts inspection: bounded orders");
  console.log(`Chain: ${profile.chainName} (${chainId})`);
  console.log(`Market: ${manifest.market.symbol} at ${manifest.market.address} (${manifestPath})`);

  for (const [name, address] of [
    ["orderManager", manifest.venue.orderManager],
    ["poolTickBounds", manifest.venue.poolTickBounds],
    ["stateView", manifest.venue.stateView],
  ] as const) {
    await assertDeployedBytecode(publicClient, name, address);
  }

  const fromBlock = resolveEnvBlock(
    process.env.POPCHARTS_INSPECT_FROM_BLOCK ?? manifest.blockNumber ?? "0",
    "POPCHARTS_INSPECT_FROM_BLOCK",
  );
  const staleOrderBlocks = resolveEnvCount(
    process.env.POPCHARTS_INSPECT_STALE_ORDER_BLOCKS,
    COMPLETE_SET_KEEPER_POLICY.staleCrossedOrderBlocks,
    "POPCHARTS_INSPECT_STALE_ORDER_BLOCKS",
  );
  const staleDeferredBlocks = resolveEnvCount(
    process.env.POPCHARTS_INSPECT_STALE_DEFERRED_BLOCKS,
    COMPLETE_SET_KEEPER_POLICY.staleDeferredExecutionBlocks,
    "POPCHARTS_INSPECT_STALE_DEFERRED_BLOCKS",
  );
  const strict = process.env.POPCHARTS_INSPECT_STRICT === "true";
  const currentBlock = await publicClient.getBlockNumber();
  console.log(`Scanning events from block ${fromBlock} to ${currentBlock}.`);

  const orderLogs = await publicClient.getContractEvents({
    abi: ORDER_LIFECYCLE_EVENTS_ABI,
    address: manifest.venue.orderManager,
    fromBlock,
    strict: true,
    toBlock: "latest",
  });
  const pendingDeferred = await findPendingDeferredExecutions({
    fromBlock,
    orderManager: manifest.venue.orderManager,
    poolIds: [manifest.pools.yes.poolId, manifest.pools.no.poolId],
    publicClient,
  });

  const inspections: BoundedPoolInspection[] = [];
  const poolReports: PoolReport[] = [];
  for (const side of ["yes", "no"] as const) {
    const pool = manifest.pools[side];
    const { inspection, report } = await inspectPool({
      currentBlock,
      manifest,
      orderLogs,
      pendingDeferred,
      pool,
      publicClient,
      side,
    });
    inspections.push(inspection);
    poolReports.push(report);
  }

  const anomalies = detectBoundedOrderAnomalies({
    currentBlock,
    pools: inspections,
    staleCrossedOrderBlocks: staleOrderBlocks,
    staleDeferredExecutionBlocks: staleDeferredBlocks,
  });
  if (anomalies.length === 0) {
    console.log("No anomalies detected.");
  } else {
    console.log(`Anomalies (${anomalies.length}):`);
    for (const anomaly of anomalies) {
      console.log(`  [${anomaly.code}] ${anomaly.message}`);
    }
  }

  const summary = {
    anomalies,
    chainId,
    currentBlock: currentBlock.toString(),
    fromBlock: fromBlock.toString(),
    market: manifest.market.address,
    pools: poolReports,
    strict,
  };
  console.log(`INSPECT_BOUNDED_ORDERS_SUMMARY=${JSON.stringify(summary)}`);

  if (strict && anomalies.length > 0) {
    throw new Error(
      `Strict inspection failed: ${anomalies.length} anomaly(ies) detected ` +
        `(${anomalies.map((anomaly: BoundedOrderAnomaly) => anomaly.code).join(", ")}).`,
    );
  }
}

await main();

type OrderLifecycleLog = {
  readonly args: Record<string, unknown>;
  readonly blockNumber: bigint | null;
  readonly eventName: string;
};

type PoolReport = {
  readonly boundLowerTick: number | null;
  readonly boundUpperTick: number | null;
  readonly boundsConfigured: boolean;
  readonly currentTick: number;
  readonly displayPrice: string;
  readonly eventCounts: Record<string, number>;
  readonly openOrders: readonly {
    readonly ageBlocks: string;
    readonly liquidity: string;
    readonly orderId: number;
    readonly owner: Address;
    readonly tickLower: number;
    readonly tickUpper: number;
    readonly zeroForOne: boolean;
  }[];
  readonly pendingDeferred: readonly {
    readonly ageBlocks: string;
    readonly executionId: Hex;
    readonly remainingOrderCount: string;
  }[];
  readonly poolId: Hex;
  readonly side: "no" | "yes";
  readonly whitelisted: boolean;
};

async function inspectPool(args: {
  readonly currentBlock: bigint;
  readonly manifest: CompleteSetMarketManifestData;
  readonly orderLogs: readonly OrderLifecycleLog[];
  readonly pendingDeferred: Awaited<ReturnType<typeof findPendingDeferredExecutions>>;
  readonly pool: CompleteSetMarketPool;
  readonly publicClient: PublicClient;
  readonly side: "no" | "yes";
}): Promise<{ inspection: BoundedPoolInspection; report: PoolReport }> {
  const { currentBlock, manifest, pool, publicClient, side } = args;
  const label = side.toUpperCase();
  const poolLogs = args.orderLogs.filter(
    (log) => String(log.args.poolId).toLowerCase() === pool.poolId.toLowerCase(),
  );
  const eventCounts: Record<string, number> = {};
  for (const log of poolLogs) {
    eventCounts[log.eventName] = (eventCounts[log.eventName] ?? 0) + 1;
  }

  const price = await readPoolDisplayPrice({
    collateralDecimals: manifest.collateral.decimals,
    outcomeDecimals: manifest.market.outcomeDecimals,
    outcomeIsCurrency0: pool.outcomeIsCurrency0,
    poolId: pool.poolId,
    publicClient,
    stateView: manifest.venue.stateView,
  });
  const whitelisted = await publicClient.readContract({
    abi: POOL_WHITELISTED_ABI,
    address: manifest.venue.orderManager,
    args: [pool.poolId],
    functionName: "poolWhitelisted",
  });
  const [boundsConfigured, lowerTick, upperTick] = await publicClient.readContract({
    abi: GET_POOL_TICK_BOUNDS_ABI,
    address: manifest.venue.poolTickBounds,
    args: [pool.poolId],
    functionName: "getPoolTickBounds",
  });

  // An order is open while getOrder still reports a non-zero owner; filled
  // and cancelled orders are deleted from storage.
  const openOrders: {
    createdAtBlock: bigint;
    liquidity: bigint;
    orderId: number;
    owner: Address;
    tickLower: number;
    tickUpper: number;
    zeroForOne: boolean;
  }[] = [];
  for (const log of poolLogs) {
    if (log.eventName !== "OrderCreated" || log.blockNumber === null) {
      continue;
    }
    const orderId = Number(log.args.orderId);
    const order = await readBoundedOrder({
      orderId,
      orderManager: manifest.venue.orderManager,
      poolId: pool.poolId,
      publicClient,
    });
    if (order.owner === ZERO_ADDRESS) {
      continue;
    }
    openOrders.push({
      createdAtBlock: log.blockNumber,
      liquidity: order.liquidity,
      orderId,
      owner: order.owner,
      tickLower: order.tickLower,
      tickUpper: order.tickUpper,
      zeroForOne: order.zeroForOne,
    });
  }

  const poolDeferred = args.pendingDeferred.filter(
    (execution) => execution.poolId.toLowerCase() === pool.poolId.toLowerCase(),
  );

  console.log(`${label} pool ${pool.poolId}:`);
  console.log(
    `  tick ${price.tick} (display ${formatUnits(price.displayPriceWad, 18)}), ` +
      `bounds ${boundsConfigured ? `[${lowerTick}, ${upperTick}]` : "UNSET"}, ` +
      `whitelisted ${whitelisted}`,
  );
  console.log(
    `  events: ${
      Object.entries(eventCounts)
        .map(([name, count]) => `${name} ${count}`)
        .join(", ") || "none"
    }`,
  );
  for (const order of openOrders) {
    console.log(
      `  open order #${order.orderId}: owner ${order.owner}, ticks ` +
        `[${order.tickLower}, ${order.tickUpper}], zeroForOne ${order.zeroForOne}, ` +
        `liquidity ${order.liquidity}, age ${currentBlock - order.createdAtBlock} blocks`,
    );
  }
  if (openOrders.length === 0) {
    console.log("  open orders: none");
  }
  for (const execution of poolDeferred) {
    console.log(
      `  pending deferred ${execution.executionId}: ${execution.remainingOrderCount} orders ` +
        `remaining, age ${currentBlock - execution.storedAtBlock} blocks`,
    );
  }

  return {
    inspection: {
      boundsConfigured,
      currentTick: price.tick,
      deferredExecutions: poolDeferred.map((execution) => ({
        executionId: execution.executionId,
        remainingOrderCount: execution.remainingOrderCount,
        storedAtBlock: execution.storedAtBlock,
      })),
      orders: openOrders.map((order) => ({
        createdAtBlock: order.createdAtBlock,
        orderId: order.orderId,
        tickLower: order.tickLower,
        tickUpper: order.tickUpper,
        zeroForOne: order.zeroForOne,
      })),
      side,
      whitelisted,
    },
    report: {
      boundLowerTick: boundsConfigured ? lowerTick : null,
      boundUpperTick: boundsConfigured ? upperTick : null,
      boundsConfigured,
      currentTick: price.tick,
      displayPrice: formatUnits(price.displayPriceWad, 18),
      eventCounts,
      openOrders: openOrders.map((order) => ({
        ageBlocks: (currentBlock - order.createdAtBlock).toString(),
        liquidity: order.liquidity.toString(),
        orderId: order.orderId,
        owner: order.owner,
        tickLower: order.tickLower,
        tickUpper: order.tickUpper,
        zeroForOne: order.zeroForOne,
      })),
      pendingDeferred: poolDeferred.map((execution) => ({
        ageBlocks: (currentBlock - execution.storedAtBlock).toString(),
        executionId: execution.executionId,
        remainingOrderCount: execution.remainingOrderCount.toString(),
      })),
      poolId: pool.poolId,
      side,
      whitelisted,
    },
  };
}

function resolveEnvBlock(raw: string, label: string): bigint {
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Expected ${label} to be a block number, received ${raw}.`);
  }
  return BigInt(raw);
}

function resolveEnvCount(raw: string | undefined, fallback: number, label: string): number {
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected ${label} to be a positive integer, received ${raw}.`);
  }
  return parsed;
}
