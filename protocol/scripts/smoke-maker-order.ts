import { relative, resolve } from "node:path";

import hre, { network } from "hardhat";
import { formatUnits, getAddress, parseEventLogs, type Abi, type Address, type Hex } from "viem";

import { initializeWalletScriptEnvironment } from "./shared/cli/initializeScriptEnvironment.js";
import { parseDecimalTokenAmount } from "./shared/cli/parseDecimalTokenAmount.js";
import { assertDeployedBytecode } from "./shared/contract/assertDeployedBytecode.js";
import { readVenueStackAddress } from "./shared/deployment/readVenueStackAddress.js";
import { ensureTokenPullerBytecode } from "./shared/deployment/tokenPuller.js";
import { writeJsonFile } from "./shared/json/jsonFile.js";
import { COMPLETE_SET_MARKET_STATUS } from "./shared/market/completeSetMarketStatus.js";
import { COMPLETE_SET_SMOKE_POLICY } from "./shared/market/completeSetSmokePolicy.js";
import { ensureCollateralBalance } from "./shared/market/ensureCollateralBalance.js";
import { ensureDevBackstopLiquidity } from "./shared/market/ensureDevBackstopLiquidity.js";
import { readCompleteSetMarketManifest } from "./shared/market/readCompleteSetMarketManifest.js";
import { readPoolDisplayPrice } from "./shared/market/readPoolDisplayPrice.js";
import type { SmokeMakerOrderManifest } from "./shared/market/readSmokeMakerOrderManifest.js";
import { SMOKE_ORDER_DEPLOYMENT } from "./shared/market/smokeOrderDeployment.js";
import { alignTickToSpacing } from "./shared/price/alignTickToSpacing.js";
import { sqrtPriceX96ToDisplayPriceWad } from "./shared/price/sqrtPriceX96ToDisplayPriceWad.js";
import { tickToSqrtPriceX96 } from "./shared/price/tickToSqrtPriceX96.js";
import { approveErc20 } from "./shared/viem/approveErc20.js";
import { readErc20Balance } from "./shared/viem/readErc20Balance.js";
import { requireSuccessfulReceipt } from "./shared/viem/requireSuccessfulReceipt.js";

const HOOK_DATA_NONE: Hex = "0x";
// Allowance lifetime when the token puller is the canonical transfer-approval
// singleton; long enough for one smoke run, short enough to expire afterward.
const ALLOWANCE_EXPIRATION_SECONDS = 3600;

const TRANSFER_APPROVAL_ABI = [
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "spender", type: "address" },
      { name: "amount", type: "uint160" },
      { name: "expiration", type: "uint48" },
    ],
    name: "approve",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * Smoke flow 1 (protocol MVP tracker item 3): mints complete sets from
 * collateral, approves the order manager's token puller, places one maker
 * order at policy-aligned ticks in the YES pool, reads the order back, and
 * writes a smoke maker-order manifest for the taker-swap flow.
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

  console.log("Pop Charts smoke flow: maker order");
  console.log(`Chain: ${profile.chainName} (${chainId})`);
  console.log(`Market: ${manifest.market.symbol} at ${manifest.market.address} (${manifestPath})`);
  console.log(`Account: ${account}`);

  for (const [name, address] of [
    ["market", manifest.market.address],
    ["yesToken", manifest.market.yesToken],
    ["collateral", manifest.collateral.address],
    ["orderManager", manifest.venue.orderManager],
    ["poolManager", manifest.venue.poolManager],
    ["stateView", manifest.venue.stateView],
  ] as const) {
    await assertDeployedBytecode(publicClient, name, address);
  }

  const makerCollateral = parseDecimalTokenAmount(
    process.env.POPCHARTS_SMOKE_MAKER_COLLATERAL ?? COMPLETE_SET_SMOKE_POLICY.makerCollateral,
    { decimals: manifest.collateral.decimals, label: "POPCHARTS_SMOKE_MAKER_COLLATERAL" },
  );
  const enablePartialFill = process.env.POPCHARTS_SMOKE_ORDER_PARTIAL_FILL === "true";
  const pool = manifest.pools.yes;

  const market = await connection.viem.getContractAt(
    "CompleteSetBinaryMarket",
    manifest.market.address,
  );
  const status = Number(await market.read.status());
  if (status !== COMPLETE_SET_MARKET_STATUS.trading) {
    throw new Error(
      `Market ${manifest.market.address} is not in Trading status (status ${status}). ` +
        "Create a fresh market with pnpm local:create-complete-set-market.",
    );
  }

  // Crossing swaps pay makers straight from PoolManager reserves during
  // afterSwap, so the pool needs base two-sided depth before the taker-swap
  // flow can execute the fill (same shape as the order-manager test setup).
  const swapRouter = await readVenueStackAddress({
    chainEnv: profile.chainEnv,
    env: process.env,
    expectedChainId: chainId,
    name: "swapRouter",
    protocolRoot: hre.config.paths.root,
  });
  const devCollateral = parseDecimalTokenAmount(
    process.env.POPCHARTS_SMOKE_LP_COLLATERAL ?? COMPLETE_SET_SMOKE_POLICY.devLiquidityCollateral,
    { decimals: manifest.collateral.decimals, label: "POPCHARTS_SMOKE_LP_COLLATERAL" },
  );
  await ensureDevBackstopLiquidity({
    account,
    chainId,
    devCollateral,
    manifest,
    publicClient,
    sides: ["yes"],
    swapRouter,
    walletClient,
  });

  // Mint the maker's complete-set inventory from collateral.
  await ensureCollateralBalance({
    chainId,
    collateral: manifest.collateral.address,
    owner: account,
    publicClient,
    requiredAmount: makerCollateral,
    requirementLabel: "POPCHARTS_SMOKE_MAKER_COLLATERAL",
    walletClient,
  });
  await approveErc20({
    amount: makerCollateral,
    publicClient,
    spender: manifest.market.address,
    token: manifest.collateral.address,
    walletClient,
  });
  const expectedOutcomeAmount = (await market.read.outcomeAmountForCollateral([
    makerCollateral,
  ])) as bigint;
  const yesBalanceBefore = await readErc20Balance(publicClient, manifest.market.yesToken, account);
  const mintHash = await market.write.mintCompleteSets([account, makerCollateral]);
  await requireSuccessfulReceipt(publicClient, mintHash, "mintCompleteSets");
  const yesBalanceAfter = await readErc20Balance(publicClient, manifest.market.yesToken, account);
  if (yesBalanceAfter - yesBalanceBefore !== expectedOutcomeAmount) {
    throw new Error(
      `mintCompleteSets minted ${yesBalanceAfter - yesBalanceBefore} YES raw units, ` +
        `expected ${expectedOutcomeAmount}.`,
    );
  }
  console.log(
    `Minted ${formatUnits(expectedOutcomeAmount, manifest.market.outcomeDecimals)} YES/NO ` +
      `complete sets from ${formatUnits(makerCollateral, manifest.collateral.decimals)} collateral.`,
  );

  // Maker sells YES above the current price: pick a policy-aligned one-sided
  // range on the outcome side of the current tick.
  const price = await readPoolDisplayPrice({
    collateralDecimals: manifest.collateral.decimals,
    outcomeDecimals: manifest.market.outcomeDecimals,
    outcomeIsCurrency0: pool.outcomeIsCurrency0,
    poolId: pool.poolId,
    publicClient,
    stateView: manifest.venue.stateView,
  });
  const spacing = pool.poolKey.tickSpacing;
  const zeroForOne = pool.outcomeIsCurrency0;
  let tickLower: number;
  let tickUpper: number;
  if (zeroForOne) {
    tickLower =
      alignTickToSpacing(price.tick, spacing, "down") +
      COMPLETE_SET_SMOKE_POLICY.orderOffsetSpacings * spacing;
    tickUpper = tickLower + COMPLETE_SET_SMOKE_POLICY.orderWidthSpacings * spacing;
  } else {
    tickUpper =
      alignTickToSpacing(price.tick, spacing, "up") -
      COMPLETE_SET_SMOKE_POLICY.orderOffsetSpacings * spacing;
    tickLower = tickUpper - COMPLETE_SET_SMOKE_POLICY.orderWidthSpacings * spacing;
  }
  if (tickLower < pool.boundLowerTick || tickUpper > pool.boundUpperTick) {
    throw new Error(
      `Maker order range [${tickLower}, ${tickUpper}] falls outside the pool's epsilon ` +
        `bounds [${pool.boundLowerTick}, ${pool.boundUpperTick}]; the pool price is too close ` +
        "to a bound for the smoke maker order.",
    );
  }

  const orderManager = await connection.viem.getContractAt(
    "BoundedPoolOrderManager",
    manifest.venue.orderManager,
  );
  const amountInMaximum = expectedOutcomeAmount;
  const minimumOrderAmount = (await orderManager.read.minimumOrderAmount([
    pool.outcomeToken,
  ])) as bigint;
  if (amountInMaximum < minimumOrderAmount) {
    throw new Error(
      `Maker input ${amountInMaximum} is below the order manager minimum ` +
        `${minimumOrderAmount} for ${pool.outcomeToken}. Raise POPCHARTS_SMOKE_MAKER_COLLATERAL ` +
        "or lower the minimum via setMinimumOrderAmount.",
    );
  }

  const tokenPuller = getAddress((await orderManager.read.tokenPuller()) as Address);
  const pullerMode = await ensureTokenPullerBytecode({
    chainId,
    connection,
    publicClient,
    tokenPuller,
  });
  await approveErc20({
    amount: amountInMaximum,
    publicClient,
    spender: tokenPuller,
    token: pool.outcomeToken,
    walletClient,
  });
  if (pullerMode === "transferApproval") {
    // Canonical singleton: the order manager pulls through its own allowance
    // recorded on the singleton, so grant it explicitly with an expiration.
    const expiration = Math.floor(Date.now() / 1000) + ALLOWANCE_EXPIRATION_SECONDS;
    const allowanceHash = await walletClient.writeContract({
      abi: TRANSFER_APPROVAL_ABI,
      address: tokenPuller,
      args: [pool.outcomeToken, manifest.venue.orderManager, amountInMaximum, expiration],
      functionName: "approve",
    });
    await requireSuccessfulReceipt(publicClient, allowanceHash, "transfer-approval approve");
  }
  console.log(`Token puller ${tokenPuller} ready (${pullerMode} mode).`);

  const createHash = await orderManager.write.createOrder([
    {
      amountInMaximum,
      enablePartialFill,
      hookData: HOOK_DATA_NONE,
      key: pool.poolKey,
      tickLower,
      tickUpper,
      zeroForOne,
    },
  ]);
  const createReceipt = await requireSuccessfulReceipt(publicClient, createHash, "createOrder");
  const orderManagerAbi = (await hre.artifacts.readArtifact("BoundedPoolOrderManager")).abi as Abi;
  const createdEvents = parseEventLogs({
    abi: orderManagerAbi,
    eventName: "OrderCreated",
    logs: createReceipt.logs.filter(
      (log) => getAddress(log.address) === manifest.venue.orderManager,
    ),
  });
  const createdEvent = createdEvents[0];
  if (createdEvents.length !== 1 || createdEvent === undefined) {
    throw new Error(
      `createOrder ${createHash} emitted ${createdEvents.length} OrderCreated events, expected 1.`,
    );
  }
  const created = createdEvent.args as {
    amountIn: bigint;
    liquidity: bigint;
    orderId: number;
    owner: Address;
  };

  const order = (await orderManager.read.getOrder([pool.poolId, created.orderId])) as {
    enablePartialFill: boolean;
    indexedTick: number;
    liquidity: bigint;
    owner: Address;
    tickLower: number;
    tickUpper: number;
    zeroForOne: boolean;
  };
  if (getAddress(order.owner) !== account) {
    throw new Error(
      `Order ${created.orderId} read back with owner ${order.owner}, not ${account}.`,
    );
  }
  if (
    order.liquidity !== created.liquidity ||
    order.tickLower !== tickLower ||
    order.tickUpper !== tickUpper ||
    order.zeroForOne !== zeroForOne
  ) {
    throw new Error(
      `Order ${created.orderId} read back as liquidity ${order.liquidity} ` +
        `ticks [${order.tickLower}, ${order.tickUpper}] zeroForOne ${order.zeroForOne}, ` +
        `expected liquidity ${created.liquidity} ticks [${tickLower}, ${tickUpper}] ` +
        `zeroForOne ${zeroForOne}.`,
    );
  }

  const smokeOrderFile = resolve(
    hre.config.paths.root,
    process.env.POPCHARTS_SMOKE_ORDER_FILE ||
      SMOKE_ORDER_DEPLOYMENT.defaultDeploymentFile(profile.chainEnv),
  );
  const smokeOrderManifest = {
    chainId,
    generatedAt: new Date().toISOString(),
    marketManifest: manifestPath,
    order: {
      amountIn: created.amountIn.toString(),
      enablePartialFill,
      liquidity: created.liquidity.toString(),
      orderId: created.orderId,
      tickLower,
      tickUpper,
      zeroForOne,
    },
    pool: { poolId: pool.poolId, side: "yes" },
    transactions: { createOrder: createHash, mintCompleteSets: mintHash },
  } satisfies SmokeMakerOrderManifest;
  await writeJsonFile(smokeOrderFile, smokeOrderManifest);

  const displayPriceAtTick = (tick: number): string =>
    formatUnits(
      sqrtPriceX96ToDisplayPriceWad({
        collateralDecimals: manifest.collateral.decimals,
        outcomeDecimals: manifest.market.outcomeDecimals,
        outcomeIsCurrency0: pool.outcomeIsCurrency0,
        sqrtPriceX96: tickToSqrtPriceX96(tick),
      }),
      18,
    );
  console.log("Maker order placed:");
  console.log(`  pool: YES ${pool.poolId}`);
  console.log(`  orderId: ${created.orderId} (owner ${order.owner})`);
  console.log(
    `  range: ticks [${tickLower}, ${tickUpper}] ` +
      `(display ${displayPriceAtTick(tickLower)} .. ${displayPriceAtTick(tickUpper)})`,
  );
  console.log(
    `  amountIn: ${formatUnits(created.amountIn, manifest.market.outcomeDecimals)} YES ` +
      `(liquidity ${created.liquidity}, partialFill ${enablePartialFill})`,
  );
  console.log(
    `  pool price: ${formatUnits(price.displayPriceWad, 18)} collateral/YES (tick ${price.tick})`,
  );
  console.log(`Wrote ${relative(hre.config.paths.root, smokeOrderFile)}`);
}

await main();
