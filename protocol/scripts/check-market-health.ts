import hre, { network } from "hardhat";
import { erc20Abi, formatUnits } from "viem";

import { resolveDeploymentChainProfile } from "./shared/chain/resolveDeploymentChainProfile.js";
import { parseDecimalTokenAmount } from "./shared/cli/parseDecimalTokenAmount.js";
import { assertDeployedBytecode } from "./shared/contract/assertDeployedBytecode.js";
import { assertHardhatNetwork } from "./shared/hardhat/assertHardhatNetwork.js";
import { COMPLETE_SET_KEEPER_POLICY } from "./shared/market/completeSetKeeperPolicy.js";
import { COMPLETE_SET_MARKET_STATUS } from "./shared/market/completeSetMarketStatus.js";
import { evaluateMarketHealth } from "./shared/market/evaluateMarketHealth.js";
import { readCompleteSetMarketManifest } from "./shared/market/readCompleteSetMarketManifest.js";
import { readPoolActiveLiquidity } from "./shared/market/readPoolActiveLiquidity.js";
import { readPoolDisplayPrice } from "./shared/market/readPoolDisplayPrice.js";
import { readErc20Balance } from "./shared/viem/readErc20Balance.js";

const MARKET_STATUS_ABI = [
  {
    inputs: [],
    name: "status",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "winningSide",
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
    type: "function",
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

const STATUS_NAMES: Record<number, string> = {
  [COMPLETE_SET_MARKET_STATUS.cancelled]: "Cancelled",
  [COMPLETE_SET_MARKET_STATUS.resolved]: "Resolved",
  [COMPLETE_SET_MARKET_STATUS.trading]: "Trading",
};

/**
 * Read-only market health check (protocol MVP tracker item 4): reads the
 * complete-set market's lifecycle status, its collateral escrow versus
 * outstanding outcome supply (the no-shortfall invariant), the YES+NO display
 * price-sum drift against a tolerance, active pool liquidity, configured tick
 * bounds, and order-manager whitelisting. Prints a MARKET_HEALTH_SUMMARY JSON
 * line and exits nonzero when the collateral invariant is violated.
 *
 * Env vars: POPCHARTS_HEALTH_PRICE_SUM_TOLERANCE (decimal WAD price, default
 * from COMPLETE_SET_KEEPER_POLICY).
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

  console.log("Pop Charts health check: complete-set market");
  console.log(`Chain: ${profile.chainName} (${chainId})`);
  console.log(`Market: ${manifest.market.symbol} at ${manifest.market.address} (${manifestPath})`);

  for (const [name, address] of [
    ["market", manifest.market.address],
    ["yesToken", manifest.market.yesToken],
    ["noToken", manifest.market.noToken],
    ["collateral", manifest.collateral.address],
    ["orderManager", manifest.venue.orderManager],
    ["poolTickBounds", manifest.venue.poolTickBounds],
    ["stateView", manifest.venue.stateView],
  ] as const) {
    await assertDeployedBytecode(publicClient, name, address);
  }

  const toleranceWad = parseDecimalTokenAmount(
    process.env.POPCHARTS_HEALTH_PRICE_SUM_TOLERANCE ??
      COMPLETE_SET_KEEPER_POLICY.priceSumTolerance,
    { allowZero: true, decimals: 18, label: "POPCHARTS_HEALTH_PRICE_SUM_TOLERANCE" },
  );

  const status = Number(
    await publicClient.readContract({
      abi: MARKET_STATUS_ABI,
      address: manifest.market.address,
      functionName: "status",
    }),
  );
  const winningSide =
    status === COMPLETE_SET_MARKET_STATUS.resolved
      ? Number(
          await publicClient.readContract({
            abi: MARKET_STATUS_ABI,
            address: manifest.market.address,
            functionName: "winningSide",
          }),
        ) === 0
        ? ("yes" as const)
        : ("no" as const)
      : undefined;

  const collateralBalance = await readErc20Balance(
    publicClient,
    manifest.collateral.address,
    manifest.market.address,
  );
  const yesSupply = await publicClient.readContract({
    abi: erc20Abi,
    address: manifest.market.yesToken,
    functionName: "totalSupply",
  });
  const noSupply = await publicClient.readContract({
    abi: erc20Abi,
    address: manifest.market.noToken,
    functionName: "totalSupply",
  });

  const pools = [];
  const prices: Record<"no" | "yes", bigint> = { no: 0n, yes: 0n };
  for (const side of ["yes", "no"] as const) {
    const pool = manifest.pools[side];
    const price = await readPoolDisplayPrice({
      collateralDecimals: manifest.collateral.decimals,
      outcomeDecimals: manifest.market.outcomeDecimals,
      outcomeIsCurrency0: pool.outcomeIsCurrency0,
      poolId: pool.poolId,
      publicClient,
      stateView: manifest.venue.stateView,
    });
    prices[side] = price.displayPriceWad;
    const activeLiquidity = await readPoolActiveLiquidity({
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
    const [boundsConfigured] = await publicClient.readContract({
      abi: GET_POOL_TICK_BOUNDS_ABI,
      address: manifest.venue.poolTickBounds,
      args: [pool.poolId],
      functionName: "getPoolTickBounds",
    });
    pools.push({ activeLiquidity, boundsConfigured, side, whitelisted });
  }

  const statusName = STATUS_NAMES[status] ?? `Unknown(${status})`;
  console.log(
    `Status: ${statusName}${winningSide === undefined ? "" : ` (winner ${winningSide})`}`,
  );
  console.log(
    `Collateral escrow: ${formatUnits(collateralBalance, manifest.collateral.decimals)}; ` +
      `supplies YES ${formatUnits(yesSupply, manifest.market.outcomeDecimals)}, ` +
      `NO ${formatUnits(noSupply, manifest.market.outcomeDecimals)}`,
  );
  console.log(
    `Prices: YES ${formatUnits(prices.yes, 18)} + NO ${formatUnits(prices.no, 18)} = ` +
      `${formatUnits(prices.yes + prices.no, 18)} (tolerance ${formatUnits(toleranceWad, 18)})`,
  );

  const { healthy, issues } = evaluateMarketHealth({
    collateralBalance,
    collateralDecimals: manifest.collateral.decimals,
    noDisplayPriceWad: prices.no,
    noSupply,
    outcomeDecimals: manifest.market.outcomeDecimals,
    pools,
    priceSumToleranceWad: toleranceWad,
    status,
    ...(winningSide === undefined ? {} : { winningSide }),
    yesDisplayPriceWad: prices.yes,
    yesSupply,
  });
  for (const issue of issues) {
    console.log(`  [${issue.severity}] [${issue.code}] ${issue.message}`);
  }
  if (issues.length === 0) {
    console.log("All health checks passed.");
  }

  const summary = {
    chainId,
    collateralBalance: collateralBalance.toString(),
    healthy,
    issues,
    market: manifest.market.address,
    noSupply: noSupply.toString(),
    priceNo: formatUnits(prices.no, 18),
    priceSum: formatUnits(prices.yes + prices.no, 18),
    priceYes: formatUnits(prices.yes, 18),
    status: statusName,
    winningSide: winningSide ?? null,
    yesSupply: yesSupply.toString(),
  };
  console.log(`MARKET_HEALTH_SUMMARY=${JSON.stringify(summary)}`);

  if (!healthy) {
    throw new Error(
      `Market health violation(s): ${issues
        .filter((issue) => issue.severity === "violation")
        .map((issue) => issue.code)
        .join(", ")}.`,
    );
  }
}

await main();
