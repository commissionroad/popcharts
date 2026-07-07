import { formatUnits, type Address, type Hex, type PublicClient } from "viem";

import { alignTickToSpacing } from "../price/alignTickToSpacing.js";
import { liquidityForAmounts } from "../price/liquidityForAmounts.js";
import { tickToSqrtPriceX96 } from "../price/tickToSqrtPriceX96.js";
import { approveErc20 } from "../viem/approveErc20.js";
import { requireSuccessfulReceipt } from "../viem/requireSuccessfulReceipt.js";
import { COMPLETE_SET_SMOKE_POLICY } from "./completeSetSmokePolicy.js";
import { ensureCollateralBalance } from "./ensureCollateralBalance.js";
import { readPoolActiveLiquidity } from "./readPoolActiveLiquidity.js";
import { readPoolDisplayPrice } from "./readPoolDisplayPrice.js";
import {
  completeSetBinaryMarketAbi,
  minimalV4SwapRouterAbi,
} from "../../../src/generated/postgrad-venue.js";
import type { CompleteSetMarketManifestData } from "./readCompleteSetMarketManifest.js";

const HOOK_DATA_NONE: Hex = "0x";
const ZERO_SALT: Hex = "0x0000000000000000000000000000000000000000000000000000000000000000";

type SmokeContractWriter = {
  writeContract(parameters: {
    abi: readonly unknown[];
    address: Address;
    args: readonly unknown[];
    functionName: string;
  }): Promise<Hex>;
};

/**
 * Seeds one clearly-labelled dev backstop liquidity position in each listed
 * pool that currently has no active liquidity (plan doc: testnet-only
 * convenience depth). Maker fills pay makers straight from PoolManager
 * reserves during afterSwap, so a pool needs two-sided depth before crossing
 * swaps can execute orders; the position is funded by minting complete sets
 * for the outcome leg and holding the same collateral budget for the
 * collateral leg.
 */
export async function ensureDevBackstopLiquidity(args: {
  readonly account: Address;
  readonly chainId: number;
  readonly devCollateral: bigint;
  readonly manifest: CompleteSetMarketManifestData;
  readonly publicClient: PublicClient;
  readonly sides: readonly ("no" | "yes")[];
  readonly swapRouter: Address;
  readonly walletClient: SmokeContractWriter;
}): Promise<void> {
  for (const side of args.sides) {
    const pool = args.manifest.pools[side];
    const activeLiquidity = await readPoolActiveLiquidity({
      poolId: pool.poolId,
      publicClient: args.publicClient,
      stateView: args.manifest.venue.stateView,
    });
    if (activeLiquidity > 0n) {
      continue;
    }

    const price = await readPoolDisplayPrice({
      collateralDecimals: args.manifest.collateral.decimals,
      outcomeDecimals: args.manifest.market.outcomeDecimals,
      outcomeIsCurrency0: pool.outcomeIsCurrency0,
      poolId: pool.poolId,
      publicClient: args.publicClient,
      stateView: args.manifest.venue.stateView,
    });
    const spacing = pool.poolKey.tickSpacing;
    const halfWidth = COMPLETE_SET_SMOKE_POLICY.devLiquidityRangeSpacings * spacing;
    const tickLower = Math.max(
      alignTickToSpacing(price.tick - halfWidth, spacing, "down"),
      pool.boundLowerTick,
    );
    const tickUpper = Math.min(
      alignTickToSpacing(price.tick + halfWidth, spacing, "up"),
      pool.boundUpperTick,
    );
    if (tickLower >= tickUpper) {
      throw new Error(
        `Dev liquidity range collapsed for the ${side.toUpperCase()} pool ` +
          `(ticks [${tickLower}, ${tickUpper}]); the pool price sits too close to its bounds.`,
      );
    }

    // Fund both sides: mint complete sets for the outcome leg and hold the
    // same collateral budget for the collateral leg.
    const devOutcome = await args.publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: args.manifest.market.address,
      args: [args.devCollateral],
      functionName: "outcomeAmountForCollateral",
    });
    await ensureCollateralBalance({
      chainId: args.chainId,
      collateral: args.manifest.collateral.address,
      owner: args.account,
      publicClient: args.publicClient,
      requiredAmount: args.devCollateral * 2n,
      requirementLabel: "POPCHARTS_SMOKE_LP_COLLATERAL",
      walletClient: args.walletClient,
    });
    await approveErc20({
      amount: args.devCollateral,
      publicClient: args.publicClient,
      spender: args.manifest.market.address,
      token: args.manifest.collateral.address,
      walletClient: args.walletClient,
    });
    const mintHash = await args.walletClient.writeContract({
      abi: completeSetBinaryMarketAbi,
      address: args.manifest.market.address,
      args: [args.account, args.devCollateral],
      functionName: "mintCompleteSets",
    });
    await requireSuccessfulReceipt(args.publicClient, mintHash, "dev liquidity mint");

    const liquidity = liquidityForAmounts({
      amount0Max: pool.outcomeIsCurrency0 ? devOutcome : args.devCollateral,
      amount1Max: pool.outcomeIsCurrency0 ? args.devCollateral : devOutcome,
      sqrtPriceLowerX96: tickToSqrtPriceX96(tickLower),
      sqrtPriceUpperX96: tickToSqrtPriceX96(tickUpper),
      sqrtPriceX96: price.sqrtPriceX96,
    });
    if (liquidity <= 0n) {
      throw new Error(
        `Computed zero dev liquidity for the ${side.toUpperCase()} pool; raise ` +
          "POPCHARTS_SMOKE_LP_COLLATERAL.",
      );
    }

    await approveErc20({
      amount: devOutcome,
      publicClient: args.publicClient,
      spender: args.swapRouter,
      token: pool.outcomeToken,
      walletClient: args.walletClient,
    });
    await approveErc20({
      amount: args.devCollateral,
      publicClient: args.publicClient,
      spender: args.swapRouter,
      token: args.manifest.collateral.address,
      walletClient: args.walletClient,
    });
    const seedHash = await args.walletClient.writeContract({
      abi: minimalV4SwapRouterAbi,
      address: args.swapRouter,
      args: [
        pool.poolKey,
        { liquidityDelta: liquidity, salt: ZERO_SALT, tickLower, tickUpper },
        HOOK_DATA_NONE,
      ],
      functionName: "modifyLiquidity",
    });
    await requireSuccessfulReceipt(args.publicClient, seedHash, "dev liquidity seed");
    console.log(
      `Seeded DEV BACKSTOP liquidity in the ${side.toUpperCase()} pool: liquidity ${liquidity} ` +
        `over ticks [${tickLower}, ${tickUpper}] (budget ` +
        `${formatUnits(args.devCollateral, args.manifest.collateral.decimals)} collateral per leg).`,
    );
  }
}
