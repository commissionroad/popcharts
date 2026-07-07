import hre, { network } from "hardhat";
import { formatUnits, getAddress, parseEventLogs, type Abi, type Hex } from "viem";

import { initializeWalletScriptEnvironment } from "./shared/cli/initializeScriptEnvironment.js";
import { parseDecimalTokenAmount } from "./shared/cli/parseDecimalTokenAmount.js";
import { assertDeployedBytecode } from "./shared/contract/assertDeployedBytecode.js";
import { readVenueStackAddress } from "./shared/deployment/readVenueStackAddress.js";
import { COMPLETE_SET_SMOKE_POLICY } from "./shared/market/completeSetSmokePolicy.js";
import { ensureCollateralBalance } from "./shared/market/ensureCollateralBalance.js";
import { readBoundedOrder } from "./shared/market/readBoundedOrder.js";
import { readCompleteSetMarketManifest } from "./shared/market/readCompleteSetMarketManifest.js";
import { readPoolDisplayPrice } from "./shared/market/readPoolDisplayPrice.js";
import { readSmokeMakerOrderManifest } from "./shared/market/readSmokeMakerOrderManifest.js";
import { tickToSqrtPriceX96 } from "./shared/price/tickToSqrtPriceX96.js";
import { approveErc20 } from "./shared/viem/approveErc20.js";
import { readErc20Balance } from "./shared/viem/readErc20Balance.js";
import { requireSuccessfulReceipt } from "./shared/viem/requireSuccessfulReceipt.js";

const HOOK_DATA_NONE: Hex = "0x";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Smoke flow 2 (protocol MVP tracker item 3): swaps collateral for outcome
 * tokens through the venue swap router so the pool tick crosses the smoke
 * maker order's range, then verifies the hook's movePoolTick path executed by
 * checking OrderFilled/OrderPartiallyFilled/DeferredExecutionStored events
 * and the post-swap order state.
 */
async function main() {
  const { account, chainId, connection, profile, publicClient, walletClient } =
    await initializeWalletScriptEnvironment({ accountRole: "smoke", network });
  const { manifest, manifestPath } = await readCompleteSetMarketManifest({
    chainEnv: profile.chainEnv,
    env: process.env,
    expectedChainId: chainId,
    protocolRoot: hre.config.paths.root,
  });
  const { manifest: smokeOrder, manifestPath: smokeOrderPath } = await readSmokeMakerOrderManifest({
    chainEnv: profile.chainEnv,
    env: process.env,
    expectedChainId: chainId,
    protocolRoot: hre.config.paths.root,
  });

  console.log("Pop Charts smoke flow: taker swap");
  console.log(`Chain: ${profile.chainName} (${chainId})`);
  console.log(`Market: ${manifest.market.symbol} at ${manifest.market.address} (${manifestPath})`);
  console.log(`Maker order: #${smokeOrder.order.orderId} from ${smokeOrderPath}`);
  console.log(`Account: ${account}`);

  const pool = manifest.pools[smokeOrder.pool.side];
  if (pool.poolId !== smokeOrder.pool.poolId) {
    throw new Error(
      `Smoke maker-order manifest ${smokeOrderPath} targets pool ${smokeOrder.pool.poolId}, ` +
        `but market manifest ${manifestPath} has ${pool.poolId} for the ` +
        `${smokeOrder.pool.side.toUpperCase()} pool. Rerun pnpm local:smoke-maker-order against ` +
        "this market.",
    );
  }
  const swapRouter = await readVenueStackAddress({
    chainEnv: profile.chainEnv,
    env: process.env,
    expectedChainId: chainId,
    name: "swapRouter",
    protocolRoot: hre.config.paths.root,
  });
  for (const [name, address] of [
    ["swapRouter", swapRouter],
    ["orderManager", manifest.venue.orderManager],
    ["boundedHook", manifest.venue.boundedHook],
    ["collateral", manifest.collateral.address],
  ] as const) {
    await assertDeployedBytecode(publicClient, name, address);
  }

  const orderManager = await connection.viem.getContractAt(
    "BoundedPoolOrderManager",
    manifest.venue.orderManager,
  );
  const orderBefore = await readBoundedOrder({
    orderId: smokeOrder.order.orderId,
    orderManager: manifest.venue.orderManager,
    poolId: pool.poolId,
    publicClient,
  });
  if (orderBefore.owner === ZERO_ADDRESS) {
    throw new Error(
      `Maker order #${smokeOrder.order.orderId} no longer exists (already filled or cancelled). ` +
        "Place a fresh order with pnpm local:smoke-maker-order.",
    );
  }

  const takerCollateral = parseDecimalTokenAmount(
    process.env.POPCHARTS_SMOKE_TAKER_COLLATERAL ?? COMPLETE_SET_SMOKE_POLICY.takerCollateral,
    { decimals: manifest.collateral.decimals, label: "POPCHARTS_SMOKE_TAKER_COLLATERAL" },
  );

  const priceBefore = await readPoolDisplayPrice({
    collateralDecimals: manifest.collateral.decimals,
    outcomeDecimals: manifest.market.outcomeDecimals,
    outcomeIsCurrency0: pool.outcomeIsCurrency0,
    poolId: pool.poolId,
    publicClient,
    stateView: manifest.venue.stateView,
  });

  // The taker buys outcome tokens, moving the pool tick across the maker
  // order's full-fill threshold; the price limit sits a policy margin past
  // the order's far tick, clamped to the pool's epsilon bounds.
  const spacing = pool.poolKey.tickSpacing;
  const margin = COMPLETE_SET_SMOKE_POLICY.crossMarginSpacings * spacing;
  const takerZeroForOne = !orderBefore.zeroForOne;
  const targetTick = orderBefore.zeroForOne
    ? Math.min(orderBefore.tickUpper + margin, pool.boundUpperTick)
    : Math.max(orderBefore.tickLower - margin, pool.boundLowerTick);
  const sqrtPriceLimitX96 = tickToSqrtPriceX96(targetTick);

  await ensureCollateralBalance({
    chainId,
    collateral: manifest.collateral.address,
    owner: account,
    publicClient,
    requiredAmount: takerCollateral,
    requirementLabel: "POPCHARTS_SMOKE_TAKER_COLLATERAL",
    walletClient,
  });
  await approveErc20({
    amount: takerCollateral,
    publicClient,
    spender: swapRouter,
    token: manifest.collateral.address,
    walletClient,
  });

  const outcomeBefore = await readErc20Balance(publicClient, pool.outcomeToken, account);
  const collateralBefore = await readErc20Balance(
    publicClient,
    manifest.collateral.address,
    account,
  );

  const router = await connection.viem.getContractAt("MinimalV4SwapRouter", swapRouter);
  const swapHash = await router.write.swap([
    pool.poolKey,
    {
      amountSpecified: -takerCollateral,
      sqrtPriceLimitX96,
      zeroForOne: takerZeroForOne,
    },
    account,
    HOOK_DATA_NONE,
  ]);
  const swapReceipt = await requireSuccessfulReceipt(publicClient, swapHash, "taker swap");

  const orderManagerAbi = (await hre.artifacts.readArtifact("BoundedPoolOrderManager")).abi as Abi;
  const orderEvents = parseEventLogs({
    abi: orderManagerAbi,
    logs: swapReceipt.logs.filter((log) => getAddress(log.address) === manifest.venue.orderManager),
  });
  const filled = orderEvents.find(
    (event) =>
      event.eventName === "OrderFilled" &&
      Number((event.args as { orderId: number }).orderId) === smokeOrder.order.orderId,
  );
  const partiallyFilled = orderEvents.find(
    (event) =>
      event.eventName === "OrderPartiallyFilled" &&
      Number((event.args as { orderId: number }).orderId) === smokeOrder.order.orderId,
  );
  const deferred = orderEvents.find((event) => event.eventName === "DeferredExecutionStored");

  const orderAfter = await readBoundedOrder({
    orderId: smokeOrder.order.orderId,
    orderManager: manifest.venue.orderManager,
    poolId: pool.poolId,
    publicClient,
  });
  const priceAfter = await readPoolDisplayPrice({
    collateralDecimals: manifest.collateral.decimals,
    outcomeDecimals: manifest.market.outcomeDecimals,
    outcomeIsCurrency0: pool.outcomeIsCurrency0,
    poolId: pool.poolId,
    publicClient,
    stateView: manifest.venue.stateView,
  });
  const outcomeAfter = await readErc20Balance(publicClient, pool.outcomeToken, account);
  const collateralAfter = await readErc20Balance(
    publicClient,
    manifest.collateral.address,
    account,
  );

  // Verify the hook actually observed this swap before crediting movePoolTick.
  const hook = await connection.viem.getContractAt(
    "BoundedPredictionHook",
    manifest.venue.boundedHook,
  );
  const [observed, , afterTick] = (await hook.read.lastSwapTickObservation([
    pool.poolId,
  ])) as readonly [boolean, number, number];
  if (!observed || afterTick !== priceAfter.tick) {
    throw new Error(
      `Hook did not observe the swap (observed ${observed}, afterTick ${afterTick}, ` +
        `pool tick ${priceAfter.tick}).`,
    );
  }

  console.log(
    `Swap ${swapHash}: spent ${formatUnits(collateralBefore - collateralAfter, manifest.collateral.decimals)} ` +
      `collateral, received ${formatUnits(outcomeAfter - outcomeBefore, manifest.market.outcomeDecimals)} ` +
      `${smokeOrder.pool.side.toUpperCase()} (net collateral delta includes maker proceeds paid ` +
      "back to this account).",
  );
  console.log(
    `Pool tick: ${priceBefore.tick} -> ${priceAfter.tick} ` +
      `(display ${formatUnits(priceBefore.displayPriceWad, 18)} -> ` +
      `${formatUnits(priceAfter.displayPriceWad, 18)} collateral/outcome)`,
  );

  if (filled !== undefined) {
    const args = filled.args as { amount0: bigint; amount1: bigint };
    const makerCollateralProceeds = pool.outcomeIsCurrency0 ? args.amount1 : args.amount0;
    const makerOutcomeReturned = pool.outcomeIsCurrency0 ? args.amount0 : args.amount1;
    if (orderAfter.owner !== ZERO_ADDRESS) {
      throw new Error(
        `OrderFilled was emitted but order #${smokeOrder.order.orderId} still exists with ` +
          `owner ${orderAfter.owner}.`,
      );
    }
    console.log(
      `Result: order #${smokeOrder.order.orderId} FILLED. Maker received ` +
        `${formatUnits(makerCollateralProceeds, manifest.collateral.decimals)} collateral and ` +
        `${formatUnits(makerOutcomeReturned, manifest.market.outcomeDecimals)} outcome; ` +
        "order deleted from the book.",
    );
    return;
  }
  if (partiallyFilled !== undefined) {
    const args = partiallyFilled.args as {
      amount0: bigint;
      amount1: bigint;
      remainingLiquidity: bigint;
    };
    console.log(
      `Result: order #${smokeOrder.order.orderId} PARTIALLY FILLED ` +
        `(amount0 ${args.amount0}, amount1 ${args.amount1}, ` +
        `remaining liquidity ${args.remainingLiquidity}; ` +
        `order liquidity now ${orderAfter.liquidity}).`,
    );
    return;
  }
  if (deferred !== undefined) {
    const args = deferred.args as { executionId: Hex; orderCount: bigint };
    const [pending, , , , , , , remainingOrderCount] =
      (await orderManager.read.getDeferredExecution([args.executionId])) as readonly [
        boolean,
        Hex,
        number,
        number,
        bigint,
        bigint,
        bigint,
        bigint,
      ];
    if (!pending) {
      throw new Error(`Deferred execution ${args.executionId} was stored but is not pending.`);
    }
    console.log(
      `Result: order #${smokeOrder.order.orderId} crossed and was DEFERRED ` +
        `(executionId ${args.executionId}, ${args.orderCount} orders stored, ` +
        `${remainingOrderCount} remaining). Drain it with the order manager's ` +
        "resolveDeferredExecution.",
    );
    return;
  }

  throw new Error(
    `Taker swap did not cross maker order #${smokeOrder.order.orderId}: no OrderFilled, ` +
      `OrderPartiallyFilled, or DeferredExecutionStored event (pool tick ended at ` +
      `${priceAfter.tick}, order range [${orderBefore.tickLower}, ${orderBefore.tickUpper}]). ` +
      "Increase POPCHARTS_SMOKE_TAKER_COLLATERAL so the swap can reach the order's far tick.",
  );
}

await main();
