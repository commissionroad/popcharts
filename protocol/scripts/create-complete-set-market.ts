import { relative, resolve } from "node:path";

import hre, { network } from "hardhat";
import { erc20Abi, type Address, type Hex, type PublicClient } from "viem";

import { assertNativeBalance } from "./shared/account/assertNativeBalance.js";
import type { DeploymentChainProfile } from "./shared/chain/resolveDeploymentChainProfile.js";
import { initializeWalletScriptEnvironment } from "./shared/cli/initializeScriptEnvironment.js";
import { requireAddress, requireString } from "../src/cli/requireCliValue.js";
import { assertDeployedBytecode } from "./shared/contract/assertDeployedBytecode.js";
import { ARC_PROTOCOL_DEPLOYMENT } from "./shared/deployment/arcProtocol.js";
import { readManifestAddresses } from "./shared/deployment/readManifestAddresses.js";
import { resolveDeploymentManifestFile } from "./shared/deployment/resolveDeploymentManifestFile.js";
import { POSTGRAD_VENUE_DEPLOYMENT } from "../src/deployment/postgradVenueDeployment.js";
import { VENUE_STACK_DEPLOYMENT } from "../src/deployment/venueStackDeployment.js";
import { writeJsonFile } from "../src/json/jsonFile.js";
import { COMPLETE_SET_MARKET_DEPLOYMENT } from "../src/market/completeSetMarketDeployment.js";
import {
  configureOutcomePool,
  deployCompleteSetBinaryMarket,
  type MarketPoolManifestEntry,
} from "./shared/market/deployCompleteSetMarketContracts.js";
import { printDeploymentHeader } from "./shared/log/printDeploymentHeader.js";
import { clampDisplayPriceWad } from "../src/price/clampDisplayPriceWad.js";
import { COMPLETE_SET_PRICE_POLICY } from "../src/price/completeSetPricePolicy.js";
import { parseDisplayPriceWad } from "./shared/price/parseDisplayPriceWad.js";

const WAD = 10n ** 18n;

// Testnet default only; graduated markets should open at their clearing
// reference price instead (plan doc, Pool And Price Plan).
const DEFAULT_OPENING_DISPLAY_PRICE_WAD = WAD / 2n;
const DEFAULT_MARKET_NAME = "Pop Charts Complete Set Market";
const DEFAULT_MARKET_SYMBOL = COMPLETE_SET_MARKET_DEPLOYMENT.defaultMarketSymbol;

type CompleteSetMarketManifest = {
  readonly blockNumber: string;
  readonly chainId: number;
  readonly collateral: {
    readonly address: Address;
    readonly decimals: number;
  };
  readonly deployer: Address;
  readonly generatedAt: string;
  readonly market: {
    readonly address: Address;
    readonly deploymentTransaction: Hex;
    readonly name: string;
    readonly noToken: Address;
    readonly outcomeDecimals: number;
    readonly owner: Address;
    readonly resolver: Address;
    readonly retainedMinter: Address;
    readonly symbol: string;
    readonly yesToken: Address;
  };
  readonly pools: {
    readonly no: MarketPoolManifestEntry;
    readonly yes: MarketPoolManifestEntry;
  };
  readonly rpcUrl: string;
  readonly venue: {
    readonly boundedHook: Address;
    readonly orderManager: Address;
    readonly poolManager: Address;
    readonly poolTickBounds: Address;
    readonly stateView: Address;
  };
};

/**
 * Creates one complete-set market for direct testnet trading against a
 * previously deployed venue and postgrad stack: deploys a standalone
 * CompleteSetBinaryMarket with its YES/NO tokens, initializes the two bounded
 * v4 pools at the target opening display price, configures the ADR 0009
 * epsilon tick bounds, whitelists both pools in the order manager, and writes
 * a market manifest.
 */
async function main() {
  const {
    account: deployerAddress,
    chainId,
    config,
    connection,
    profile,
    publicClient,
    walletClient,
  } = await initializeWalletScriptEnvironment({
    accountRole: "deployer",
    loadConfig: (profile) => loadConfig(process.env, profile),
    network,
  });
  const balance = await assertNativeBalance({
    chainName: profile.chainName,
    currencySymbol: profile.nativeCurrency.symbol,
    deployerAddress,
    publicClient,
  });

  printDeploymentHeader({
    balance,
    chainId,
    chainName: profile.chainName,
    contractName: `Pop Charts complete-set market ${config.marketSymbol}`,
    currencyDecimals: profile.nativeCurrency.decimals,
    currencySymbol: profile.nativeCurrency.symbol,
    deployerAddress,
    rpcUrl: config.rpcUrl,
  });

  // The market's pools live on the v4 stack and its bounds/whitelisting are
  // owned by the postgrad venue contracts, so fail with a pointer to the
  // producing deploy instead of broadcasting partial state.
  const venue = await readManifestAddresses({
    deployHint: VENUE_STACK_DEPLOYMENT.deployHint,
    expectedChainId: chainId,
    kind: "venue",
    manifestFile: config.venueDeploymentFile,
    names: ["poolManager", "stateView"],
    protocolRoot: hre.config.paths.root,
  });
  const postgrad = await readManifestAddresses({
    deployHint: POSTGRAD_VENUE_DEPLOYMENT.deployHint,
    expectedChainId: chainId,
    kind: "postgrad",
    manifestFile: config.postgradDeploymentFile,
    names: ["boundedHook", "orderManager", "poolTickBounds"],
    protocolRoot: hre.config.paths.root,
  });
  for (const [name, address] of [
    ["poolManager", venue.poolManager],
    ["stateView", venue.stateView],
    ["poolTickBounds", postgrad.poolTickBounds],
    ["orderManager", postgrad.orderManager],
    ["boundedHook", postgrad.boundedHook],
  ] as const) {
    await assertDeployedBytecode(publicClient, name, address);
  }

  const collateral = await resolveCollateral({
    chainId,
    env: process.env,
    protocolRoot: hre.config.paths.root,
    publicClient,
  });
  console.log(`Collateral token: ${collateral.address} (${collateral.decimals} decimals)`);

  // Direct testnet path: the deployer EOA holds retained-mint authority so
  // operators can seed inventory by hand. Adapter-prepared markets come from
  // graduation instead, where CompleteSetPostgradAdapter retains mint
  // authority itself (ADR 0009).
  const ownerAddress = config.ownerAddress ?? deployerAddress;
  const resolverAddress = config.resolverAddress ?? deployerAddress;
  const { marketAddress, marketDeployHash, noToken, yesToken } =
    await deployCompleteSetBinaryMarket({
      collateralAddress: collateral.address,
      connection,
      deployerAddress,
      marketName: config.marketName,
      marketSymbol: config.marketSymbol,
      ownerAddress,
      resolverAddress,
      walletClient,
    });
  console.log(`CompleteSetBinaryMarket: ${marketAddress}`);
  console.log(`YES token: ${yesToken}`);
  console.log(`NO token: ${noToken}`);

  // Complementary opening prices keep YES + NO near one complete set (plan
  // doc, Pool And Price Plan); both clamp into the ADR 0009 epsilon band.
  const yesOpeningDisplayPriceWad = clampDisplayPriceWad(config.openingDisplayPriceWad);
  const noOpeningDisplayPriceWad = clampDisplayPriceWad(WAD - yesOpeningDisplayPriceWad);

  // One pool per outcome token: initialize at the opening price, configure the
  // ADR 0009 epsilon tick bounds, and whitelist the pool for maker orders.
  const poolArgs = {
    collateral,
    connection,
    orderManagerAddress: postgrad.orderManager,
    poolTickBoundsAddress: postgrad.poolTickBounds,
    venue: {
      boundedHook: postgrad.boundedHook,
      poolManager: venue.poolManager,
      stateView: venue.stateView,
    },
    walletClient,
  } as const;
  const yesPool = await configureOutcomePool({
    ...poolArgs,
    openingDisplayPriceWad: yesOpeningDisplayPriceWad,
    outcomeToken: yesToken,
    side: "YES",
  });
  const noPool = await configureOutcomePool({
    ...poolArgs,
    openingDisplayPriceWad: noOpeningDisplayPriceWad,
    outcomeToken: noToken,
    side: "NO",
  });

  const blockNumber = await publicClient.getBlockNumber();
  const manifest: CompleteSetMarketManifest = {
    blockNumber: blockNumber.toString(),
    chainId,
    collateral,
    deployer: deployerAddress,
    generatedAt: new Date().toISOString(),
    market: {
      address: marketAddress,
      deploymentTransaction: marketDeployHash,
      name: config.marketName,
      noToken,
      outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
      owner: ownerAddress,
      resolver: resolverAddress,
      retainedMinter: deployerAddress,
      symbol: config.marketSymbol,
      yesToken,
    },
    pools: { no: noPool, yes: yesPool },
    rpcUrl: config.rpcUrl,
    venue: {
      boundedHook: postgrad.boundedHook,
      orderManager: postgrad.orderManager,
      poolManager: venue.poolManager,
      poolTickBounds: postgrad.poolTickBounds,
      stateView: venue.stateView,
    },
  };
  await writeJsonFile(config.marketDeploymentFile, manifest);
  console.log(`Wrote ${relative(hre.config.paths.root, config.marketDeploymentFile)}`);
}

await main();

/**
 * Reads operator settings and resolves repo-local manifest paths for one chain.
 */
function loadConfig(env: NodeJS.ProcessEnv, profile: DeploymentChainProfile) {
  const marketName = requireString(
    env.POPCHARTS_MARKET_NAME ?? DEFAULT_MARKET_NAME,
    "POPCHARTS_MARKET_NAME",
  );
  const marketSymbol = requireString(
    env.POPCHARTS_MARKET_SYMBOL ?? DEFAULT_MARKET_SYMBOL,
    "POPCHARTS_MARKET_SYMBOL",
  );

  return {
    marketDeploymentFile: resolve(
      hre.config.paths.root,
      env.POPCHARTS_MARKET_DEPLOYMENT_FILE ||
        COMPLETE_SET_MARKET_DEPLOYMENT.defaultDeploymentFile(profile.chainEnv, marketSymbol),
    ),
    marketName,
    marketSymbol,
    openingDisplayPriceWad:
      env.POPCHARTS_OPENING_DISPLAY_PRICE === undefined
        ? DEFAULT_OPENING_DISPLAY_PRICE_WAD
        : parseDisplayPriceWad(
            env.POPCHARTS_OPENING_DISPLAY_PRICE,
            "POPCHARTS_OPENING_DISPLAY_PRICE",
          ),
    ownerAddress:
      env.POPCHARTS_MARKET_OWNER === undefined
        ? undefined
        : requireAddress(env.POPCHARTS_MARKET_OWNER, "POPCHARTS_MARKET_OWNER"),
    postgradDeploymentFile: resolveDeploymentManifestFile(POSTGRAD_VENUE_DEPLOYMENT, {
      chainEnv: profile.chainEnv,
      env,
      protocolRoot: hre.config.paths.root,
    }),
    resolverAddress:
      env.POPCHARTS_MARKET_RESOLVER === undefined
        ? undefined
        : requireAddress(env.POPCHARTS_MARKET_RESOLVER, "POPCHARTS_MARKET_RESOLVER"),
    rpcUrl: env.POPCHARTS_RPC_URL || profile.defaultRpcUrl,
    venueDeploymentFile: resolveDeploymentManifestFile(VENUE_STACK_DEPLOYMENT, {
      chainEnv: profile.chainEnv,
      env,
      protocolRoot: hre.config.paths.root,
    }),
  };
}

// The market escrows this token forever, so resolve it from an explicit env
// var or a protocol manifest and verify bytecode before deploying anything.
async function resolveCollateral({
  chainId,
  env,
  protocolRoot,
  publicClient,
}: {
  chainId: number;
  env: NodeJS.ProcessEnv;
  protocolRoot: string;
  publicClient: PublicClient;
}): Promise<{ address: Address; decimals: number }> {
  let collateralAddress: Address;
  if (env.POPCHARTS_COLLATERAL_ADDRESS !== undefined) {
    collateralAddress = requireAddress(
      env.POPCHARTS_COLLATERAL_ADDRESS,
      "POPCHARTS_COLLATERAL_ADDRESS",
    );
  } else {
    ({ collateral: collateralAddress } = await readManifestAddresses({
      deployHint:
        "Set POPCHARTS_COLLATERAL_ADDRESS (pnpm local:deploy-pregrad prints a local " +
        "MockCollateral address) or provide a protocol manifest with a collateral entry.",
      expectedChainId: chainId,
      kind: "protocol",
      manifestFile: resolve(
        protocolRoot,
        env[ARC_PROTOCOL_DEPLOYMENT.deploymentFileEnvVar] ||
          ARC_PROTOCOL_DEPLOYMENT.defaultDeploymentFile,
      ),
      names: ["collateral"],
      protocolRoot,
    }));
  }

  await assertDeployedBytecode(publicClient, "collateral token", collateralAddress);
  const decimals = await publicClient.readContract({
    abi: erc20Abi,
    address: collateralAddress,
    functionName: "decimals",
  });
  return { address: collateralAddress, decimals };
}
