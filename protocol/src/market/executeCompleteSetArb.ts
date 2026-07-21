import { formatUnits, type Address, type PublicClient } from "viem";

import { tickToSqrtPriceX96 } from "../price/tickToSqrtPriceX96.js";
import { approveErc20 } from "../viem/approveErc20.js";
import type { ContractWriter } from "../viem/contractWriter.js";
import { readErc20Balance } from "../viem/readErc20Balance.js";
import { requireSuccessfulReceipt } from "../viem/requireSuccessfulReceipt.js";
import { ensureCollateralBalance } from "./ensureCollateralBalance.js";
import { floorOutcomeToCollateralUnit } from "./floorOutcomeToCollateralUnit.js";
import { HOOK_DATA_NONE } from "./hookData.js";
import type {
  CompleteSetMarketManifestData,
  CompleteSetMarketPool,
} from "./readCompleteSetMarketManifest.js";
import { completeSetBinaryMarketAbi, minimalV4SwapRouterAbi } from "../generated/postgrad-venue.js";

type ArbContext = {
  readonly account: Address;
  readonly arbCollateral: bigint;
  readonly chainId: number;
  readonly collateralLabel: string;
  readonly manifest: CompleteSetMarketManifestData;
  readonly publicClient: PublicClient;
  readonly swapRouter: Address;
  readonly walletClient: ContractWriter;
};

/**
 * Executes one complete-set arbitrage round trip in a Trading market (plan
 * doc keeper loop; whitepaper complete-set economics): `mintAndSell` mints
 * sets at par and sells both sides to push the displayed price sum down
 * toward one, `buyAndMerge` buys both sides below par and merges them back
 * into collateral to push the sum up. Both pools need active two-sided depth
 * before calling this. Returns the caller's collateral delta for the trip.
 */
export async function executeCompleteSetArb(args: {
  readonly account: Address;
  readonly action: "buyAndMerge" | "mintAndSell";
  readonly arbCollateral: bigint;
  readonly chainId: number;
  /** Env var or option name shown when the account cannot fund the trip. */
  readonly collateralLabel: string;
  readonly manifest: CompleteSetMarketManifestData;
  readonly publicClient: PublicClient;
  readonly swapRouter: Address;
  readonly walletClient: ContractWriter;
}): Promise<{ readonly collateralDelta: bigint }> {
  if (args.arbCollateral <= 0n) {
    throw new Error(`Expected a positive arbCollateral, received ${args.arbCollateral}.`);
  }

  const collateralBefore = await readErc20Balance(
    args.publicClient,
    args.manifest.collateral.address,
    args.account,
  );
  if (args.action === "mintAndSell") {
    await mintAndSellBothSides(args);
  } else {
    await buyBothSidesAndMerge(args);
  }
  const collateralAfter = await readErc20Balance(
    args.publicClient,
    args.manifest.collateral.address,
    args.account,
  );
  return { collateralDelta: collateralAfter - collateralBefore };
}

async function readOutcomeAmountForCollateral(
  context: ArbContext,
  collateralAmount: bigint,
): Promise<bigint> {
  return context.publicClient.readContract({
    abi: completeSetBinaryMarketAbi,
    address: context.manifest.market.address,
    args: [collateralAmount],
    functionName: "outcomeAmountForCollateral",
  });
}

async function swapThroughRouter(
  context: ArbContext,
  pool: CompleteSetMarketPool,
  params: { amountSpecified: bigint; limitTick: number; zeroForOne: boolean },
  label: string,
): Promise<void> {
  const swapHash = await context.walletClient.writeContract({
    abi: minimalV4SwapRouterAbi,
    address: context.swapRouter,
    args: [
      pool.poolKey,
      {
        amountSpecified: params.amountSpecified,
        sqrtPriceLimitX96: tickToSqrtPriceX96(params.limitTick),
        zeroForOne: params.zeroForOne,
      },
      context.account,
      HOOK_DATA_NONE,
    ],
    functionName: "swap",
  });
  await requireSuccessfulReceipt(context.publicClient, swapHash, label);
}

// Price sum above one: mint complete sets at par and sell both sides into
// their pools, pushing both displayed prices down toward YES + NO = 1.
async function mintAndSellBothSides(context: ArbContext): Promise<void> {
  await ensureCollateralBalance({
    chainId: context.chainId,
    collateral: context.manifest.collateral.address,
    owner: context.account,
    publicClient: context.publicClient,
    requiredAmount: context.arbCollateral,
    requirementLabel: context.collateralLabel,
    walletClient: context.walletClient,
  });
  await approveErc20({
    amount: context.arbCollateral,
    publicClient: context.publicClient,
    spender: context.manifest.market.address,
    token: context.manifest.collateral.address,
    walletClient: context.walletClient,
  });
  const outcomeAmount = await readOutcomeAmountForCollateral(context, context.arbCollateral);
  const mintHash = await context.walletClient.writeContract({
    abi: completeSetBinaryMarketAbi,
    address: context.manifest.market.address,
    args: [context.account, context.arbCollateral],
    functionName: "mintCompleteSets",
  });
  await requireSuccessfulReceipt(context.publicClient, mintHash, "arb mintCompleteSets");
  console.log(
    `Minted ${formatUnits(outcomeAmount, context.manifest.market.outcomeDecimals)} complete sets ` +
      `from ${formatUnits(context.arbCollateral, context.manifest.collateral.decimals)} collateral.`,
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
    await swapThroughRouter(
      context,
      pool,
      { amountSpecified: -outcomeAmount, limitTick, zeroForOne: pool.outcomeIsCurrency0 },
      `sell ${side.toUpperCase()}`,
    );
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
async function buyBothSidesAndMerge(context: ArbContext): Promise<void> {
  const outcomeTarget = await readOutcomeAmountForCollateral(context, context.arbCollateral);
  await ensureCollateralBalance({
    chainId: context.chainId,
    collateral: context.manifest.collateral.address,
    owner: context.account,
    publicClient: context.publicClient,
    requiredAmount: context.arbCollateral * 2n,
    requirementLabel: context.collateralLabel,
    walletClient: context.walletClient,
  });
  await approveErc20({
    amount: context.arbCollateral * 2n,
    publicClient: context.publicClient,
    spender: context.swapRouter,
    token: context.manifest.collateral.address,
    walletClient: context.walletClient,
  });

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
    await swapThroughRouter(
      context,
      pool,
      { amountSpecified: outcomeTarget, limitTick, zeroForOne: !pool.outcomeIsCurrency0 },
      `buy ${side.toUpperCase()}`,
    );
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
    abi: completeSetBinaryMarketAbi,
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
