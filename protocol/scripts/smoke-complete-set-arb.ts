import hre, { network } from "hardhat";
import { formatUnits, type PublicClient } from "viem";

import { initializeWalletScriptEnvironment } from "./shared/cli/initializeScriptEnvironment.js";
import { parseDecimalTokenAmount } from "./shared/cli/parseDecimalTokenAmount.js";
import { assertDeployedBytecode } from "./shared/contract/assertDeployedBytecode.js";
import { readVenueStackAddress } from "./shared/deployment/readVenueStackAddress.js";
import { COMPLETE_SET_MARKET_STATUS } from "./shared/market/completeSetMarketStatus.js";
import { COMPLETE_SET_SMOKE_POLICY } from "../src/market/completeSetSmokePolicy.js";
import { decideCompleteSetArbAction } from "../src/market/decideCompleteSetArbAction.js";
import { ensureDevBackstopLiquidity } from "../src/market/ensureDevBackstopLiquidity.js";
import { executeCompleteSetArb } from "../src/market/executeCompleteSetArb.js";
import {
  readCompleteSetMarketManifest,
  type CompleteSetMarketManifestData,
  type CompleteSetMarketPool,
} from "../src/market/readCompleteSetMarketManifest.js";
import { readPoolDisplayPrice, type PoolDisplayPrice } from "../src/market/readPoolDisplayPrice.js";

/**
 * Smoke flow 3 (protocol MVP tracker item 3): reads YES and NO displayed
 * prices, decides the complete-set arbitrage direction from the price sum,
 * executes one small round trip (mint sets and sell both sides above one, or
 * buy both sides and merge below one), and reports the before/after price sum
 * plus the wallet's collateral delta. Pools without active liquidity get one
 * clearly-logged dev backstop position first so the round trip has depth.
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

  const pricesBefore = await readBothPoolPrices(publicClient, manifest);
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

  const { collateralDelta } = await executeCompleteSetArb({
    account,
    action: decision.action,
    arbCollateral,
    chainId,
    collateralLabel: "POPCHARTS_SMOKE_ARB_COLLATERAL",
    manifest,
    publicClient,
    swapRouter,
    walletClient,
  });

  const pricesAfter = await readBothPoolPrices(publicClient, manifest);
  const priceSumAfterWad = pricesAfter.yes.displayPriceWad + pricesAfter.no.displayPriceWad;

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

async function readBothPoolPrices(
  publicClient: PublicClient,
  manifest: CompleteSetMarketManifestData,
): Promise<{ no: PoolDisplayPrice; yes: PoolDisplayPrice }> {
  const readOne = (pool: CompleteSetMarketPool): Promise<PoolDisplayPrice> =>
    readPoolDisplayPrice({
      collateralDecimals: manifest.collateral.decimals,
      outcomeDecimals: manifest.market.outcomeDecimals,
      outcomeIsCurrency0: pool.outcomeIsCurrency0,
      poolId: pool.poolId,
      publicClient,
      stateView: manifest.venue.stateView,
    });
  return {
    no: await readOne(manifest.pools.no),
    yes: await readOne(manifest.pools.yes),
  };
}
