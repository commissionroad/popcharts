// TESTNET-ONLY KEEPER: per the complete-set plan doc this keeper must not run
// against real-value collateral unless it is audited and product-approved
// (docs/complete-set-v4-hook-order-manager-plan.md, ADR 0009 section 6). It
// spends the operator account's collateral on arbitrage round trips and holds
// the order-manager resolver role, both acceptable only under ADR 0009's
// capped, fake-or-small testnet balances.
import hre, { network } from "hardhat";
import { formatUnits, getAddress, type Address, type PublicClient } from "viem";

import { initializeWalletScriptEnvironment } from "./shared/cli/initializeScriptEnvironment.js";
import { parseDecimalTokenAmount } from "./shared/cli/parseDecimalTokenAmount.js";
import { assertDeployedBytecode } from "./shared/contract/assertDeployedBytecode.js";
import { readVenueStackAddress } from "./shared/deployment/readVenueStackAddress.js";
import { COMPLETE_SET_KEEPER_POLICY } from "../src/market/completeSetKeeperPolicy.js";
import { COMPLETE_SET_MARKET_STATUS } from "./shared/market/completeSetMarketStatus.js";
import { COMPLETE_SET_SMOKE_POLICY } from "../src/market/completeSetSmokePolicy.js";
import { decideCompleteSetArbAction } from "../src/market/decideCompleteSetArbAction.js";
import { ensureDevBackstopLiquidity } from "../src/market/ensureDevBackstopLiquidity.js";
import { executeCompleteSetArb } from "../src/market/executeCompleteSetArb.js";
import {
  findPendingDeferredExecutions,
  type PendingDeferredExecution,
} from "../src/market/findPendingDeferredExecutions.js";
import {
  readCompleteSetMarketManifest,
  type CompleteSetMarketManifestData,
  type CompleteSetMarketPool,
} from "../src/market/readCompleteSetMarketManifest.js";
import { readPoolActiveLiquidity } from "../src/market/readPoolActiveLiquidity.js";
import { readPoolDisplayPrice, type PoolDisplayPrice } from "../src/market/readPoolDisplayPrice.js";
import { summarizeKeeperRun, type KeeperRunSummary } from "./shared/market/summarizeKeeperRun.js";
import { requireSuccessfulReceipt } from "../src/viem/requireSuccessfulReceipt.js";

/**
 * Keeper pass for one complete-set market (protocol MVP tracker item 4).
 * Each pass quotes both displayed prices, runs the complete-set arbitrage
 * round trip when |YES + NO - 1| exceeds the configured tolerance, drains
 * pending deferred executions discovered from DeferredExecutionStored events,
 * and prints one KEEPER_COMPLETE_SET_SUMMARY JSON line. Single pass by
 * default (cron-friendly); set POPCHARTS_KEEPER_LOOP_SECONDS for a loop.
 *
 * Env vars: POPCHARTS_KEEPER_ARB_COLLATERAL, POPCHARTS_KEEPER_PRICE_SUM_TOLERANCE,
 * POPCHARTS_KEEPER_FROM_BLOCK (defaults to the market manifest's blockNumber),
 * POPCHARTS_KEEPER_SEED_DEV_LIQUIDITY=true (with POPCHARTS_SMOKE_LP_COLLATERAL
 * sizing), POPCHARTS_KEEPER_LOOP_SECONDS.
 */
async function main() {
  const { account, chainId, connection, profile, publicClient, walletClient } =
    await initializeWalletScriptEnvironment({ accountRole: "keeper", network });
  const { manifest, manifestPath } = await readCompleteSetMarketManifest({
    chainEnv: profile.chainEnv,
    env: process.env,
    expectedChainId: chainId,
    protocolRoot: hre.config.paths.root,
  });

  console.log("Pop Charts keeper: complete-set market pass");
  console.log(`Chain: ${profile.chainName} (${chainId})`);
  console.log(`Market: ${manifest.market.symbol} at ${manifest.market.address} (${manifestPath})`);
  console.log(`Keeper account: ${account}`);

  const swapRouter = await readVenueStackAddress({
    chainEnv: profile.chainEnv,
    env: process.env,
    expectedChainId: chainId,
    name: "swapRouter",
    protocolRoot: hre.config.paths.root,
  });
  for (const [name, address] of [
    ["market", manifest.market.address],
    ["orderManager", manifest.venue.orderManager],
    ["stateView", manifest.venue.stateView],
    ["swapRouter", swapRouter],
    ["collateral", manifest.collateral.address],
  ] as const) {
    await assertDeployedBytecode(publicClient, name, address);
  }

  const context: KeeperContext = {
    account,
    arbCollateral: parseDecimalTokenAmount(
      process.env.POPCHARTS_KEEPER_ARB_COLLATERAL ?? COMPLETE_SET_KEEPER_POLICY.arbCollateral,
      { decimals: manifest.collateral.decimals, label: "POPCHARTS_KEEPER_ARB_COLLATERAL" },
    ),
    chainId,
    connection,
    fromBlock: resolveFromBlock(process.env, manifest),
    manifest,
    publicClient,
    seedDevLiquidity: process.env.POPCHARTS_KEEPER_SEED_DEV_LIQUIDITY === "true",
    swapRouter,
    toleranceWad: parseDecimalTokenAmount(
      process.env.POPCHARTS_KEEPER_PRICE_SUM_TOLERANCE ??
        COMPLETE_SET_KEEPER_POLICY.priceSumTolerance,
      { allowZero: true, decimals: 18, label: "POPCHARTS_KEEPER_PRICE_SUM_TOLERANCE" },
    ),
    walletClient,
  };

  const loopSeconds = resolveLoopSeconds(process.env);
  if (loopSeconds === undefined) {
    await runKeeperPass(context);
    return;
  }

  console.log(`Loop mode: one pass every ${loopSeconds}s (stop with Ctrl-C).`);
  for (;;) {
    await runKeeperPass(context);
    await new Promise((resolve) => setTimeout(resolve, loopSeconds * 1000));
  }
}

await main();

type KeeperConnection = Awaited<ReturnType<typeof network.create>>;

type KeeperContext = {
  readonly account: Address;
  readonly arbCollateral: bigint;
  readonly chainId: number;
  readonly connection: KeeperConnection;
  readonly fromBlock: bigint;
  readonly manifest: CompleteSetMarketManifestData;
  readonly publicClient: PublicClient;
  readonly seedDevLiquidity: boolean;
  readonly swapRouter: Address;
  readonly toleranceWad: bigint;
  readonly walletClient: Awaited<ReturnType<KeeperConnection["viem"]["getWalletClients"]>>[number];
};

async function runKeeperPass(context: KeeperContext): Promise<void> {
  const arb = await runArbStep(context);
  const deferred = await drainDeferredExecutions(context);

  const summary: KeeperRunSummary = summarizeKeeperRun({
    arbAction: arb.action,
    arbExecuted: arb.executed,
    ...(arb.skippedReason === undefined ? {} : { arbSkippedReason: arb.skippedReason }),
    chainId: context.chainId,
    deferredFound: deferred.found,
    deferredRemaining: deferred.remaining,
    deferredResolved: deferred.resolved,
    market: context.manifest.market.address,
    noDisplayPriceWad: arb.prices.no.displayPriceWad,
    ...(arb.priceSumAfterWad === undefined ? {} : { priceSumAfterWad: arb.priceSumAfterWad }),
    yesDisplayPriceWad: arb.prices.yes.displayPriceWad,
  });
  console.log(`KEEPER_COMPLETE_SET_SUMMARY=${JSON.stringify(summary)}`);
}

// Step (a): quote both pools and arbitrage the price sum back toward one
// full set when it drifts beyond the tolerance band.
async function runArbStep(context: KeeperContext): Promise<{
  action: "buyAndMerge" | "hold" | "mintAndSell";
  executed: boolean;
  prices: { no: PoolDisplayPrice; yes: PoolDisplayPrice };
  priceSumAfterWad?: bigint;
  skippedReason?: string;
}> {
  const prices = await readBothPoolPrices(context);
  const decision = decideCompleteSetArbAction({
    noDisplayPriceWad: prices.no.displayPriceWad,
    toleranceWad: context.toleranceWad,
    yesDisplayPriceWad: prices.yes.displayPriceWad,
  });
  console.log(
    `Prices: YES ${formatUnits(prices.yes.displayPriceWad, 18)} + ` +
      `NO ${formatUnits(prices.no.displayPriceWad, 18)} = ` +
      `${formatUnits(decision.priceSumWad, 18)} -> ${decision.action}`,
  );
  if (decision.action === "hold") {
    return { action: decision.action, executed: false, prices };
  }

  const market = await context.connection.viem.getContractAt(
    "CompleteSetBinaryMarket",
    context.manifest.market.address,
  );
  const status = Number(await market.read.status());
  if (status !== COMPLETE_SET_MARKET_STATUS.trading) {
    console.log(`Market status ${status} is not Trading; skipping the arbitrage round trip.`);
    return { action: decision.action, executed: false, prices, skippedReason: "marketNotTrading" };
  }

  // Dev liquidity top-up is opt-in (plan doc: "when explicitly configured").
  if (context.seedDevLiquidity) {
    const devCollateral = parseDecimalTokenAmount(
      process.env.POPCHARTS_SMOKE_LP_COLLATERAL ?? COMPLETE_SET_SMOKE_POLICY.devLiquidityCollateral,
      { decimals: context.manifest.collateral.decimals, label: "POPCHARTS_SMOKE_LP_COLLATERAL" },
    );
    await ensureDevBackstopLiquidity({
      account: context.account,
      chainId: context.chainId,
      devCollateral,
      manifest: context.manifest,
      publicClient: context.publicClient,
      sides: ["yes", "no"],
      swapRouter: context.swapRouter,
      walletClient: context.walletClient,
    });
  }
  for (const side of ["yes", "no"] as const) {
    const activeLiquidity = await readPoolActiveLiquidity({
      poolId: context.manifest.pools[side].poolId,
      publicClient: context.publicClient,
      stateView: context.manifest.venue.stateView,
    });
    if (activeLiquidity <= 0n) {
      console.log(
        `${side.toUpperCase()} pool has no active liquidity; skipping the arbitrage round trip ` +
          "(set POPCHARTS_KEEPER_SEED_DEV_LIQUIDITY=true to seed dev backstop depth).",
      );
      return {
        action: decision.action,
        executed: false,
        prices,
        skippedReason: "poolWithoutLiquidity",
      };
    }
  }

  const { collateralDelta } = await executeCompleteSetArb({
    account: context.account,
    action: decision.action,
    arbCollateral: context.arbCollateral,
    chainId: context.chainId,
    collateralLabel: "POPCHARTS_KEEPER_ARB_COLLATERAL",
    manifest: context.manifest,
    publicClient: context.publicClient,
    swapRouter: context.swapRouter,
    walletClient: context.walletClient,
  });
  const pricesAfter = await readBothPoolPrices(context);
  const priceSumAfterWad = pricesAfter.yes.displayPriceWad + pricesAfter.no.displayPriceWad;
  console.log(
    `Arbitrage ${decision.action} executed: price sum ` +
      `${formatUnits(decision.priceSumWad, 18)} -> ${formatUnits(priceSumAfterWad, 18)}, ` +
      `collateral delta ${formatUnits(collateralDelta, context.manifest.collateral.decimals)}.`,
  );
  return { action: decision.action, executed: true, prices, priceSumAfterWad };
}

// Step (b): discover pending deferred executions for this market's pools and
// resolve each batch until it is fully drained.
async function drainDeferredExecutions(context: KeeperContext): Promise<{
  found: number;
  remaining: number;
  resolved: number;
}> {
  const pending = await findPendingDeferredExecutions({
    fromBlock: context.fromBlock,
    orderManager: context.manifest.venue.orderManager,
    poolIds: [context.manifest.pools.yes.poolId, context.manifest.pools.no.poolId],
    publicClient: context.publicClient,
  });
  if (pending.length === 0) {
    console.log(`No pending deferred executions since block ${context.fromBlock}.`);
    return { found: 0, remaining: 0, resolved: 0 };
  }

  await requireResolverAuthority(context);

  let resolved = 0;
  for (const execution of pending) {
    console.log(
      `Resolving deferred execution ${execution.executionId} ` +
        `(${execution.remainingOrderCount} orders remaining, stored at block ` +
        `${execution.storedAtBlock}).`,
    );
    const complete = await resolveOneDeferredExecution(context, execution);
    if (complete) {
      resolved += 1;
    }
  }
  const remaining = pending.length - resolved;
  console.log(
    `Deferred executions: found ${pending.length}, resolved ${resolved}, remaining ${remaining}.`,
  );
  return { found: pending.length, remaining, resolved };
}

async function resolveOneDeferredExecution(
  context: KeeperContext,
  execution: PendingDeferredExecution,
): Promise<boolean> {
  const orderManager = await context.connection.viem.getContractAt(
    "BoundedPoolOrderManager",
    context.manifest.venue.orderManager,
  );
  // Each call consumes at most maximumExecutionCount order IDs, so repeat
  // until the batch reports non-pending, bounded by the policy iteration cap.
  for (let i = 0; i < COMPLETE_SET_KEEPER_POLICY.maxDeferredResolveIterations; i++) {
    const hash = await orderManager.write.resolveDeferredExecution([execution.executionId, 0n]);
    await requireSuccessfulReceipt(
      context.publicClient,
      hash,
      `resolveDeferredExecution ${execution.executionId}`,
    );
    const [pendingAfter, , , , , , , remainingOrderCount] =
      (await orderManager.read.getDeferredExecution([execution.executionId])) as readonly [
        boolean,
        `0x${string}`,
        number,
        number,
        bigint,
        bigint,
        bigint,
        bigint,
      ];
    if (!pendingAfter) {
      console.log(`Deferred execution ${execution.executionId} fully resolved.`);
      return true;
    }
    console.log(
      `Deferred execution ${execution.executionId} still pending ` +
        `(${remainingOrderCount} orders remaining).`,
    );
  }
  console.log(
    `Deferred execution ${execution.executionId} not fully drained within ` +
      `${COMPLETE_SET_KEEPER_POLICY.maxDeferredResolveIterations} resolver calls; ` +
      "the next keeper pass will continue.",
  );
  return false;
}

// resolveDeferredExecution is owner-or-resolver gated; fail before the first
// broadcast with the exact grant command instead of a raw revert.
async function requireResolverAuthority(context: KeeperContext): Promise<void> {
  const orderManager = await context.connection.viem.getContractAt(
    "BoundedPoolOrderManager",
    context.manifest.venue.orderManager,
  );
  const owner = getAddress((await orderManager.read.owner()) as string);
  if (owner === context.account) {
    return;
  }
  const hasResolverRole = (await orderManager.read.resolverRole([context.account])) as boolean;
  if (!hasResolverRole) {
    throw new Error(
      `Keeper account ${context.account} is neither the order-manager owner (${owner}) nor a ` +
        "registered resolver, so it cannot drain deferred executions. Have the owner grant the " +
        "role via BoundedPoolOrderManager.setResolverRole, e.g. pnpm operator:postgrad-admin " +
        `set-resolver-role --account ${context.account} --allowed true --execute.`,
    );
  }
}

async function readBothPoolPrices(
  context: KeeperContext,
): Promise<{ no: PoolDisplayPrice; yes: PoolDisplayPrice }> {
  const readOne = (pool: CompleteSetMarketPool): Promise<PoolDisplayPrice> =>
    readPoolDisplayPrice({
      collateralDecimals: context.manifest.collateral.decimals,
      outcomeDecimals: context.manifest.market.outcomeDecimals,
      outcomeIsCurrency0: pool.outcomeIsCurrency0,
      poolId: pool.poolId,
      publicClient: context.publicClient,
      stateView: context.manifest.venue.stateView,
    });
  return {
    no: await readOne(context.manifest.pools.no),
    yes: await readOne(context.manifest.pools.yes),
  };
}

// Deferred-event scans start at the explicit env block, else at the market's
// creation block so one market's keeper never replays the whole chain.
function resolveFromBlock(env: NodeJS.ProcessEnv, manifest: CompleteSetMarketManifestData): bigint {
  const raw = env.POPCHARTS_KEEPER_FROM_BLOCK ?? manifest.blockNumber ?? "0";
  if (!/^\d+$/.test(raw)) {
    throw new Error(`Expected POPCHARTS_KEEPER_FROM_BLOCK to be a block number, received ${raw}.`);
  }
  return BigInt(raw);
}

function resolveLoopSeconds(env: NodeJS.ProcessEnv): number | undefined {
  if (env.POPCHARTS_KEEPER_LOOP_SECONDS === undefined) {
    return undefined;
  }
  const seconds = Number(env.POPCHARTS_KEEPER_LOOP_SECONDS);
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error(
      "Expected POPCHARTS_KEEPER_LOOP_SECONDS to be a positive integer, received " +
        `${env.POPCHARTS_KEEPER_LOOP_SECONDS}.`,
    );
  }
  return seconds;
}
