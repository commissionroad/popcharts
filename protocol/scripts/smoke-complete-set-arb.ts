import hre, { network } from "hardhat";
import { formatUnits, type Address, type Hex, type PublicClient } from "viem";

import { getWalletClientAddress } from "./shared/account/getWalletClientAddress.js";
import { resolveDeploymentChainProfile } from "./shared/chain/resolveDeploymentChainProfile.js";
import { parseDecimalTokenAmount } from "./shared/cli/parseDecimalTokenAmount.js";
import { assertDeployedBytecode } from "./shared/contract/assertDeployedBytecode.js";
import { readVenueStackAddress } from "./shared/deployment/readVenueStackAddress.js";
import { assertHardhatNetwork } from "./shared/hardhat/assertHardhatNetwork.js";
import { COMPLETE_SET_MARKET_STATUS } from "./shared/market/completeSetMarketStatus.js";
import { COMPLETE_SET_SMOKE_POLICY } from "./shared/market/completeSetSmokePolicy.js";
import { decideCompleteSetArbAction } from "./shared/market/decideCompleteSetArbAction.js";
import { ensureCollateralBalance } from "./shared/market/ensureCollateralBalance.js";
import { ensureDevBackstopLiquidity } from "./shared/market/ensureDevBackstopLiquidity.js";
import { floorOutcomeToCollateralUnit } from "./shared/market/floorOutcomeToCollateralUnit.js";
import {
  readCompleteSetMarketManifest,
  type CompleteSetMarketManifestData,
  type CompleteSetMarketPool,
} from "./shared/market/readCompleteSetMarketManifest.js";
import {
  readPoolDisplayPrice,
  type PoolDisplayPrice,
} from "./shared/market/readPoolDisplayPrice.js";
import { tickToSqrtPriceX96 } from "./shared/price/tickToSqrtPriceX96.js";
import { approveErc20 } from "./shared/viem/approveErc20.js";
import { readErc20Balance } from "./shared/viem/readErc20Balance.js";
import { requireSuccessfulReceipt } from "./shared/viem/requireSuccessfulReceipt.js";

const HOOK_DATA_NONE: Hex = "0x";

const COMPLETE_SET_MARKET_ABI = [
  {
    inputs: [{ name: "collateralAmount", type: "uint256" }],
    name: "outcomeAmountForCollateral",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "collateralAmount", type: "uint256" },
    ],
    name: "mintCompleteSets",
    outputs: [{ name: "outcomeAmount", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ name: "outcomeAmount", type: "uint256" }],
    name: "mergeCompleteSets",
    outputs: [{ name: "collateralAmount", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * Smoke flow 3 (protocol MVP tracker item 3): reads YES and NO displayed
 * prices, decides the complete-set arbitrage direction from the price sum,
 * executes one small round trip (mint sets and sell both sides above one, or
 * buy both sides and merge below one), and reports the before/after price sum
 * plus the wallet's collateral delta. Pools without active liquidity get one
 * clearly-logged dev backstop position first so the round trip has depth.
 */
async function main() {
  const connection = await network.create();
  const profile = resolveDeploymentChainProfile(connection.networkName);
  const publicClient = await connection.viem.getPublicClient();
  const [walletClient] = await connection.viem.getWalletClients();
  if (walletClient === undefined) {
    throw new Error(
      `Expected Hardhat network ${profile.networkName} to expose a smoke account. ` +
        "Set POPCHARTS_DEPLOYER_PRIVATE_KEY.",
    );
  }
  const account = getWalletClientAddress({
    missingMessage:
      `Expected Hardhat network ${profile.networkName} to expose a smoke account. ` +
      "Set POPCHARTS_DEPLOYER_PRIVATE_KEY.",
    walletClient,
  });
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

  console.log("Pop Charts smoke flow: complete-set arbitrage");
  console.log(`Chain: ${profile.chainName} (${chainId})`);
  console.log(`Market: ${manifest.market.symbol} at ${manifest.market.address} (${manifestPath})`);
  console.log(`Account: ${account}`);

  const swapRouter = await readVenueStackAddress({
    chainEnv: profile.chainEnv,
    env: process.env,
    expectedChainId: chainId,
    name: "swapRouter",
    protocolRoot: hre.config.paths.root,
  });
  for (const [name, address] of [
    ["market", manifest.market.address],
    ["swapRouter", swapRouter],
    ["stateView", manifest.venue.stateView],
    ["collateral", manifest.collateral.address],
  ] as const) {
    await assertDeployedBytecode(publicClient, name, address);
  }

  const market = await connection.viem.getContractAt(
    "CompleteSetBinaryMarket",
    manifest.market.address,
  );
  const status = Number(await market.read.status());
  if (status !== COMPLETE_SET_MARKET_STATUS.trading) {
    throw new Error(
      `Market ${manifest.market.address} is not in Trading status (status ${status}); the arb ` +
        "flow needs mint/merge. Create a fresh market with pnpm local:create-complete-set-market.",
    );
  }

  const arbCollateral = parseDecimalTokenAmount(
    process.env.POPCHARTS_SMOKE_ARB_COLLATERAL ?? COMPLETE_SET_SMOKE_POLICY.arbCollateral,
    { decimals: manifest.collateral.decimals, label: "POPCHARTS_SMOKE_ARB_COLLATERAL" },
  );
  const toleranceWad =
    process.env.POPCHARTS_SMOKE_PRICE_SUM_TOLERANCE === undefined
      ? COMPLETE_SET_SMOKE_POLICY.priceSumToleranceWad
      : parseDecimalTokenAmount(process.env.POPCHARTS_SMOKE_PRICE_SUM_TOLERANCE, {
          allowZero: true,
          decimals: 18,
          label: "POPCHARTS_SMOKE_PRICE_SUM_TOLERANCE",
        });

  const flowContext: FlowContext = {
    account,
    chainId,
    connection,
    manifest,
    publicClient,
    swapRouter,
    walletClient,
  };

  const pricesBefore = await readBothPoolPrices(flowContext);
  const decision = decideCompleteSetArbAction({
    noDisplayPriceWad: pricesBefore.no.displayPriceWad,
    toleranceWad,
    yesDisplayPriceWad: pricesBefore.yes.displayPriceWad,
  });
  console.log(
    `Prices before: YES ${formatUnits(pricesBefore.yes.displayPriceWad, 18)} + ` +
      `NO ${formatUnits(pricesBefore.no.displayPriceWad, 18)} = ` +
      `${formatUnits(decision.priceSumWad, 18)} -> ${decision.action}`,
  );
  if (decision.action === "hold") {
    console.log(
      "Price sum is within the configured tolerance; no arbitrage round trip to execute.",
    );
    return;
  }

  // Both pools need two-sided depth for a meaningful round trip; seed any
  // still-empty pool with the dev backstop position first.
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
    sides: ["yes", "no"],
    swapRouter,
    walletClient,
  });

  const collateralBefore = await readErc20Balance(
    publicClient,
    manifest.collateral.address,
    account,
  );
  if (decision.action === "mintAndSell") {
    await mintAndSellBothSides(flowContext, arbCollateral);
  } else {
    await buyBothSidesAndMerge(flowContext, arbCollateral);
  }
  const collateralAfter = await readErc20Balance(
    publicClient,
    manifest.collateral.address,
    account,
  );

  const pricesAfter = await readBothPoolPrices(flowContext);
  const priceSumAfterWad = pricesAfter.yes.displayPriceWad + pricesAfter.no.displayPriceWad;
  const collateralDelta = collateralAfter - collateralBefore;

  console.log(
    `Prices after: YES ${formatUnits(pricesAfter.yes.displayPriceWad, 18)} + ` +
      `NO ${formatUnits(pricesAfter.no.displayPriceWad, 18)} = ${formatUnits(priceSumAfterWad, 18)}`,
  );
  console.log(
    `Round-trip collateral delta: ${formatUnits(collateralDelta, manifest.collateral.decimals)} ` +
      "(negative deltas reflect pool fees and price impact on the smoke-sized trade)",
  );

  if (decision.action === "mintAndSell" && priceSumAfterWad >= decision.priceSumWad) {
    throw new Error(
      `mintAndSell arbitrage did not lower the price sum (before ${decision.priceSumWad}, ` +
        `after ${priceSumAfterWad}).`,
    );
  }
  if (decision.action === "buyAndMerge" && priceSumAfterWad <= decision.priceSumWad) {
    throw new Error(
      `buyAndMerge arbitrage did not raise the price sum (before ${decision.priceSumWad}, ` +
        `after ${priceSumAfterWad}).`,
    );
  }
  console.log(`Arbitrage moved the price sum toward one full set (${decision.action}).`);
}

await main();

type SmokeWalletClient = {
  writeContract(parameters: {
    abi: readonly unknown[];
    address: Address;
    args: readonly unknown[];
    functionName: string;
  }): Promise<Hex>;
};

type SmokeConnection = Awaited<ReturnType<typeof network.create>>;

type FlowContext = {
  readonly account: Address;
  readonly chainId: number;
  readonly connection: SmokeConnection;
  readonly manifest: CompleteSetMarketManifestData;
  readonly publicClient: PublicClient;
  readonly swapRouter: Address;
  readonly walletClient: SmokeWalletClient;
};

async function readOutcomeAmountForCollateral(
  context: FlowContext,
  collateralAmount: bigint,
): Promise<bigint> {
  return context.publicClient.readContract({
    abi: COMPLETE_SET_MARKET_ABI,
    address: context.manifest.market.address,
    args: [collateralAmount],
    functionName: "outcomeAmountForCollateral",
  });
}

async function readBothPoolPrices(
  context: FlowContext,
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

// Price sum above one: mint complete sets at par and sell both sides into
// their pools, pushing both displayed prices down toward YES + NO = 1.
async function mintAndSellBothSides(context: FlowContext, arbCollateral: bigint): Promise<void> {
  await ensureCollateralBalance({
    chainId: context.chainId,
    collateral: context.manifest.collateral.address,
    owner: context.account,
    publicClient: context.publicClient,
    requiredAmount: arbCollateral,
    requirementLabel: "POPCHARTS_SMOKE_ARB_COLLATERAL",
    walletClient: context.walletClient,
  });
  await approveErc20({
    amount: arbCollateral,
    publicClient: context.publicClient,
    spender: context.manifest.market.address,
    token: context.manifest.collateral.address,
    walletClient: context.walletClient,
  });
  const outcomeAmount = await readOutcomeAmountForCollateral(context, arbCollateral);
  const mintHash = await context.walletClient.writeContract({
    abi: COMPLETE_SET_MARKET_ABI,
    address: context.manifest.market.address,
    args: [context.account, arbCollateral],
    functionName: "mintCompleteSets",
  });
  await requireSuccessfulReceipt(context.publicClient, mintHash, "arb mintCompleteSets");
  console.log(
    `Minted ${formatUnits(outcomeAmount, context.manifest.market.outcomeDecimals)} complete sets ` +
      `from ${formatUnits(arbCollateral, context.manifest.collateral.decimals)} collateral.`,
  );

  const router = await context.connection.viem.getContractAt(
    "MinimalV4SwapRouter",
    context.swapRouter,
  );
  for (const side of ["yes", "no"] as const) {
    const pool = context.manifest.pools[side];
    await approveErc20({
      amount: outcomeAmount,
      publicClient: context.publicClient,
      spender: context.swapRouter,
      token: pool.outcomeToken,
      walletClient: context.walletClient,
    });
    // Selling outcome pushes the display price down; the limit sits at the
    // epsilon bound in that direction.
    const limitTick = pool.outcomeIsCurrency0 ? pool.boundLowerTick : pool.boundUpperTick;
    const collateralBefore = await readErc20Balance(
      context.publicClient,
      context.manifest.collateral.address,
      context.account,
    );
    const swapHash = await router.write.swap([
      pool.poolKey,
      {
        amountSpecified: -outcomeAmount,
        sqrtPriceLimitX96: tickToSqrtPriceX96(limitTick),
        zeroForOne: pool.outcomeIsCurrency0,
      },
      context.account,
      HOOK_DATA_NONE,
    ]);
    await requireSuccessfulReceipt(context.publicClient, swapHash, `sell ${side.toUpperCase()}`);
    const collateralAfter = await readErc20Balance(
      context.publicClient,
      context.manifest.collateral.address,
      context.account,
    );
    console.log(
      `Sold ${formatUnits(outcomeAmount, context.manifest.market.outcomeDecimals)} ` +
        `${side.toUpperCase()} for ` +
        `${formatUnits(collateralAfter - collateralBefore, context.manifest.collateral.decimals)} ` +
        "collateral.",
    );
  }
}

// Price sum below one: buy both sides for less than one full set and merge
// them back into collateral at par, pushing both displayed prices up.
async function buyBothSidesAndMerge(context: FlowContext, arbCollateral: bigint): Promise<void> {
  const outcomeTarget = await readOutcomeAmountForCollateral(context, arbCollateral);
  await ensureCollateralBalance({
    chainId: context.chainId,
    collateral: context.manifest.collateral.address,
    owner: context.account,
    publicClient: context.publicClient,
    requiredAmount: arbCollateral * 2n,
    requirementLabel: "POPCHARTS_SMOKE_ARB_COLLATERAL",
    walletClient: context.walletClient,
  });
  await approveErc20({
    amount: arbCollateral * 2n,
    publicClient: context.publicClient,
    spender: context.swapRouter,
    token: context.manifest.collateral.address,
    walletClient: context.walletClient,
  });

  const router = await context.connection.viem.getContractAt(
    "MinimalV4SwapRouter",
    context.swapRouter,
  );
  const received: Record<"no" | "yes", bigint> = { no: 0n, yes: 0n };
  for (const side of ["yes", "no"] as const) {
    const pool = context.manifest.pools[side];
    // Buying outcome pushes the display price up; the limit sits at the
    // epsilon bound in that direction.
    const limitTick = pool.outcomeIsCurrency0 ? pool.boundUpperTick : pool.boundLowerTick;
    const outcomeBefore = await readErc20Balance(
      context.publicClient,
      pool.outcomeToken,
      context.account,
    );
    const swapHash = await router.write.swap([
      pool.poolKey,
      {
        amountSpecified: outcomeTarget,
        sqrtPriceLimitX96: tickToSqrtPriceX96(limitTick),
        zeroForOne: !pool.outcomeIsCurrency0,
      },
      context.account,
      HOOK_DATA_NONE,
    ]);
    await requireSuccessfulReceipt(context.publicClient, swapHash, `buy ${side.toUpperCase()}`);
    const outcomeAfter = await readErc20Balance(
      context.publicClient,
      pool.outcomeToken,
      context.account,
    );
    received[side] = outcomeAfter - outcomeBefore;
    console.log(
      `Bought ${formatUnits(received[side], context.manifest.market.outcomeDecimals)} ` +
        `${side.toUpperCase()}.`,
    );
  }

  const mergeAmount = floorOutcomeToCollateralUnit({
    collateralDecimals: context.manifest.collateral.decimals,
    outcomeAmount: received.yes < received.no ? received.yes : received.no,
    outcomeDecimals: context.manifest.market.outcomeDecimals,
  });
  if (mergeAmount <= 0n) {
    throw new Error(
      "buyAndMerge round trip received no mergeable complete sets; the pools lack liquidity " +
        "on the outcome side.",
    );
  }
  const mergeHash = await context.walletClient.writeContract({
    abi: COMPLETE_SET_MARKET_ABI,
    address: context.manifest.market.address,
    args: [mergeAmount],
    functionName: "mergeCompleteSets",
  });
  await requireSuccessfulReceipt(context.publicClient, mergeHash, "arb mergeCompleteSets");
  console.log(
    `Merged ${formatUnits(mergeAmount, context.manifest.market.outcomeDecimals)} complete sets ` +
      "back into collateral.",
  );
}
