import { relative, resolve } from "node:path";

import hre, { network } from "hardhat";
import {
  concatHex,
  encodeAbiParameters,
  erc20Abi,
  getAddress,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import { assertNativeBalance } from "./shared/account/assertNativeBalance.mjs";
import { getWalletClientAddress } from "./shared/account/getWalletClientAddress.js";
import {
  resolveDeploymentChainProfile,
  type DeploymentChainProfile,
} from "./shared/chain/resolveDeploymentChainProfile.js";
import { requireAddress, requireString } from "./shared/cli/requireCliValue.js";
import { ARC_PROTOCOL_DEPLOYMENT } from "./shared/deployment/arcProtocol.mjs";
import { collectVenueAddressEntries } from "./shared/deployment/venueManifest.js";
import { VENUE_STACK_DEPLOYMENT } from "./shared/deployment/venueStack.js";
import { assertHardhatNetwork } from "./shared/hardhat/assertHardhatNetwork.js";
import { readJsonFile, writeJsonFile } from "./shared/json/jsonFile.js";
import { COMPLETE_SET_MARKET_DEPLOYMENT } from "./shared/market/completeSetMarketDeployment.js";
import { printDeploymentHeader } from "./shared/log/printDeploymentHeader.mjs";
import { clampDisplayPriceWad } from "./shared/price/clampDisplayPriceWad.js";
import { COMPLETE_SET_PRICE_POLICY } from "./shared/price/completeSetPricePolicy.js";
import { deriveEpsilonBoundTicks } from "./shared/price/deriveEpsilonBoundTicks.js";
import { displayPriceWadToSqrtPriceX96 } from "./shared/price/displayPriceWadToSqrtPriceX96.js";
import { parseDisplayPriceWad } from "./shared/price/parseDisplayPriceWad.js";
import { sqrtPriceX96ToTick } from "./shared/price/sqrtPriceX96ToTick.js";

const WAD = 10n ** 18n;

// Testnet default only; graduated markets should open at their clearing
// reference price instead (plan doc, Pool And Price Plan).
const DEFAULT_OPENING_DISPLAY_PRICE_WAD = WAD / 2n;
const DEFAULT_MARKET_NAME = "Pop Charts Complete Set Market";
const DEFAULT_MARKET_SYMBOL = COMPLETE_SET_MARKET_DEPLOYMENT.defaultMarketSymbol;

// Minimal ABIs for the vendored v4 venue contracts this script touches; the
// local Pop Charts contracts use typed Hardhat artifacts instead.
const POOL_KEY_ABI_COMPONENTS = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;

const POOL_MANAGER_ABI = [
  {
    inputs: [
      { components: POOL_KEY_ABI_COMPONENTS, name: "key", type: "tuple" },
      { name: "sqrtPriceX96", type: "uint160" },
    ],
    name: "initialize",
    outputs: [{ name: "tick", type: "int24" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const STATE_VIEW_ABI = [
  {
    inputs: [{ name: "poolId", type: "bytes32" }],
    name: "getSlot0",
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "protocolFee", type: "uint24" },
      { name: "lpFee", type: "uint24" },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;

type PoolKeyStruct = {
  readonly currency0: Address;
  readonly currency1: Address;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: Address;
};

type MarketPoolManifestEntry = {
  readonly boundLowerTick: number;
  readonly boundUpperTick: number;
  readonly initialSqrtPriceX96: string;
  readonly initialTick: number;
  readonly openingDisplayPriceWad: string;
  readonly outcomeIsCurrency0: boolean;
  readonly outcomeToken: Address;
  readonly poolId: Hex;
  readonly poolKey: PoolKeyStruct;
  readonly transactions: {
    readonly initializePool: Hex;
    readonly setPoolTickBounds: Hex;
    readonly setPoolWhitelisted: Hex;
  };
};

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
  const connection = await network.create();
  const profile = resolveDeploymentChainProfile(connection.networkName);
  const config = loadConfig(process.env, profile);
  const publicClient = await connection.viem.getPublicClient();
  const [walletClient] = await connection.viem.getWalletClients();
  if (walletClient === undefined) {
    throw new Error(
      `Expected Hardhat network ${profile.networkName} to expose a deployer account. ` +
        "Set POPCHARTS_DEPLOYER_PRIVATE_KEY.",
    );
  }
  const deployerAddress = getWalletClientAddress({
    missingMessage:
      `Expected Hardhat network ${profile.networkName} to expose a deployer account. ` +
      "Set POPCHARTS_DEPLOYER_PRIVATE_KEY.",
    walletClient,
  });
  const chainId = await assertHardhatNetwork({
    expectedChainId: profile.chainId,
    expectedNetworkName: profile.networkName,
    networkName: connection.networkName,
    publicClient,
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

  const venue = await readVenueStackAddresses({
    chainId,
    protocolRoot: hre.config.paths.root,
    venueDeploymentFile: config.venueDeploymentFile,
  });
  const postgrad = await readPostgradVenueAddresses({
    chainId,
    postgradDeploymentFile: config.postgradDeploymentFile,
    protocolRoot: hre.config.paths.root,
  });
  for (const [name, address] of [
    ["poolManager", venue.poolManager],
    ["stateView", venue.stateView],
    ["poolTickBounds", postgrad.poolTickBounds],
    ["orderManager", postgrad.orderManager],
    ["boundedHook", postgrad.boundedHook],
  ] as const) {
    await assertBytecode(publicClient, name, address);
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
  const marketArtifact = await hre.artifacts.readArtifact("CompleteSetBinaryMarket");
  const marketDeployHash = await walletClient.sendTransaction({
    data: concatHex([
      marketArtifact.bytecode as Hex,
      encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "string" },
          { type: "string" },
          { type: "uint8" },
        ],
        [
          collateral.address,
          ownerAddress,
          deployerAddress,
          resolverAddress,
          config.marketName,
          config.marketSymbol,
          COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
        ],
      ),
    ]),
  });
  const marketReceipt = await publicClient.waitForTransactionReceipt({ hash: marketDeployHash });
  if (marketReceipt.contractAddress === null || marketReceipt.contractAddress === undefined) {
    throw new Error(`CompleteSetBinaryMarket deployment ${marketDeployHash} created no contract.`);
  }
  const marketAddress = getAddress(marketReceipt.contractAddress);
  await assertBytecode(publicClient, "completeSetMarket", marketAddress);
  const market = await connection.viem.getContractAt("CompleteSetBinaryMarket", marketAddress);
  const yesToken = getAddress((await market.read.yesToken()) as Address);
  const noToken = getAddress((await market.read.noToken()) as Address);
  console.log(`CompleteSetBinaryMarket: ${marketAddress}`);
  console.log(`YES token: ${yesToken}`);
  console.log(`NO token: ${noToken}`);

  // Complementary opening prices keep YES + NO near one complete set (plan
  // doc, Pool And Price Plan); both clamp into the ADR 0009 epsilon band.
  const yesOpeningDisplayPriceWad = clampDisplayPriceWad(config.openingDisplayPriceWad);
  const noOpeningDisplayPriceWad = clampDisplayPriceWad(WAD - yesOpeningDisplayPriceWad);

  const poolTickBounds = await connection.viem.getContractAt(
    "PoolTickBounds",
    postgrad.poolTickBounds,
  );
  const orderManager = await connection.viem.getContractAt(
    "BoundedPoolOrderManager",
    postgrad.orderManager,
  );

  // One pool per outcome token: initialize at the opening price, configure the
  // ADR 0009 epsilon tick bounds, and whitelist the pool for maker orders.
  // Every write is read back before the pool is recorded in the manifest.
  const configureOutcomePool = async (
    side: "YES" | "NO",
    outcomeToken: Address,
    openingDisplayPriceWad: bigint,
  ): Promise<MarketPoolManifestEntry> => {
    // v4 pool keys sort currencies by address, so the outcome token can land
    // on either side of the collateral.
    const outcomeIsCurrency0 = BigInt(outcomeToken) < BigInt(collateral.address);
    const poolKey: PoolKeyStruct = {
      currency0: outcomeIsCurrency0 ? outcomeToken : collateral.address,
      currency1: outcomeIsCurrency0 ? collateral.address : outcomeToken,
      fee: COMPLETE_SET_PRICE_POLICY.poolFee,
      hooks: postgrad.boundedHook,
      tickSpacing: COMPLETE_SET_PRICE_POLICY.tickSpacing,
    };
    // PoolId is keccak256(abi.encode(poolKey)) per v4-core PoolId.toId().
    const poolId = keccak256(
      encodeAbiParameters(
        [
          { type: "address" },
          { type: "address" },
          { type: "uint24" },
          { type: "int24" },
          { type: "address" },
        ],
        [poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      ),
    );

    const orientation = {
      collateralDecimals: collateral.decimals,
      outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
      outcomeIsCurrency0,
    };
    const sqrtPriceX96 = displayPriceWadToSqrtPriceX96({
      ...orientation,
      displayPriceWad: openingDisplayPriceWad,
    });
    const initializeHash = await walletClient.writeContract({
      abi: POOL_MANAGER_ABI,
      address: venue.poolManager,
      args: [poolKey, sqrtPriceX96],
      functionName: "initialize",
    });
    await publicClient.waitForTransactionReceipt({ hash: initializeHash });
    const [poolSqrtPriceX96, poolTick] = await publicClient.readContract({
      abi: STATE_VIEW_ABI,
      address: venue.stateView,
      args: [poolId],
      functionName: "getSlot0",
    });
    const expectedTick = sqrtPriceX96ToTick(sqrtPriceX96);
    if (poolSqrtPriceX96 !== sqrtPriceX96 || poolTick !== expectedTick) {
      throw new Error(
        `${side} pool ${poolId} initialized at sqrtPriceX96 ${poolSqrtPriceX96} ` +
          `tick ${poolTick}, expected ${sqrtPriceX96} tick ${expectedTick}.`,
      );
    }

    const { lowerTick, upperTick } = deriveEpsilonBoundTicks(orientation);
    if (poolTick < lowerTick || poolTick > upperTick) {
      throw new Error(
        `${side} pool opening tick ${poolTick} is outside the epsilon bounds ` +
          `[${lowerTick}, ${upperTick}].`,
      );
    }
    const setBoundsHash = await poolTickBounds.write.setPoolTickBounds([
      poolId,
      lowerTick,
      upperTick,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: setBoundsHash });
    const [configured, storedLowerTick, storedUpperTick] =
      (await poolTickBounds.read.getPoolTickBounds([poolId])) as readonly [boolean, number, number];
    if (configured !== true || storedLowerTick !== lowerTick || storedUpperTick !== upperTick) {
      throw new Error(
        `${side} pool ${poolId} bounds read back as ` +
          `(${configured}, ${storedLowerTick}, ${storedUpperTick}), ` +
          `expected (true, ${lowerTick}, ${upperTick}).`,
      );
    }

    const whitelistHash = await orderManager.write.setPoolWhitelisted([poolKey, true]);
    await publicClient.waitForTransactionReceipt({ hash: whitelistHash });
    if ((await orderManager.read.poolWhitelisted([poolId])) !== true) {
      throw new Error(`Order manager did not whitelist ${side} pool ${poolId}.`);
    }

    console.log(
      `${side} pool ${poolId}: tick ${poolTick}, bounds [${lowerTick}, ${upperTick}], whitelisted`,
    );

    return {
      boundLowerTick: lowerTick,
      boundUpperTick: upperTick,
      initialSqrtPriceX96: sqrtPriceX96.toString(),
      initialTick: poolTick,
      openingDisplayPriceWad: openingDisplayPriceWad.toString(),
      outcomeIsCurrency0,
      outcomeToken,
      poolId,
      poolKey,
      transactions: {
        initializePool: initializeHash,
        setPoolTickBounds: setBoundsHash,
        setPoolWhitelisted: whitelistHash,
      },
    };
  };

  const yesPool = await configureOutcomePool("YES", yesToken, yesOpeningDisplayPriceWad);
  const noPool = await configureOutcomePool("NO", noToken, noOpeningDisplayPriceWad);

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
    postgradDeploymentFile: resolve(
      hre.config.paths.root,
      env.POPCHARTS_POSTGRAD_DEPLOYMENT_FILE ||
        `deployments/${profile.chainEnv}.postgrad.local.json`,
    ),
    resolverAddress:
      env.POPCHARTS_MARKET_RESOLVER === undefined
        ? undefined
        : requireAddress(env.POPCHARTS_MARKET_RESOLVER, "POPCHARTS_MARKET_RESOLVER"),
    rpcUrl: env.POPCHARTS_RPC_URL || profile.defaultRpcUrl,
    venueDeploymentFile: resolve(
      hre.config.paths.root,
      env.POPCHARTS_VENUE_DEPLOYMENT_FILE ||
        VENUE_STACK_DEPLOYMENT.defaultDeploymentFile(profile.chainEnv),
    ),
  };
}

// The market's pools live on the v4 stack, so fail with a pointer to the
// venue deploy instead of broadcasting partial state.
async function readVenueStackAddresses({
  chainId,
  protocolRoot,
  venueDeploymentFile,
}: {
  chainId: number;
  protocolRoot: string;
  venueDeploymentFile: string;
}): Promise<{ poolManager: Address; stateView: Address }> {
  const manifestPath = relative(protocolRoot, venueDeploymentFile);
  let manifest: unknown;
  try {
    manifest = await readJsonFile(venueDeploymentFile);
  } catch {
    throw new Error(
      `Could not read venue manifest ${manifestPath}. Run the venue-stack deploy first ` +
        "(pnpm local:deploy-venue or pnpm arc:testnet:deploy-venue).",
    );
  }
  assertManifestChainId(manifest, manifestPath, chainId);

  const entries = collectVenueAddressEntries(manifest);
  return {
    poolManager: requireManifestAddress(entries, "poolManager", manifestPath),
    stateView: requireManifestAddress(entries, "stateView", manifestPath),
  };
}

// Bounds and whitelisting are owned by the postgrad venue contracts, so fail
// with a pointer to the postgrad deploy when its manifest is missing.
async function readPostgradVenueAddresses({
  chainId,
  postgradDeploymentFile,
  protocolRoot,
}: {
  chainId: number;
  postgradDeploymentFile: string;
  protocolRoot: string;
}): Promise<{ boundedHook: Address; orderManager: Address; poolTickBounds: Address }> {
  const manifestPath = relative(protocolRoot, postgradDeploymentFile);
  let manifest: unknown;
  try {
    manifest = await readJsonFile(postgradDeploymentFile);
  } catch {
    throw new Error(
      `Could not read postgrad manifest ${manifestPath}. Run the postgrad deploy first ` +
        "(pnpm local:deploy-postgrad or pnpm arc:testnet:deploy-postgrad).",
    );
  }
  assertManifestChainId(manifest, manifestPath, chainId);

  const entries = collectVenueAddressEntries(manifest);
  return {
    boundedHook: requireManifestAddress(entries, "boundedHook", manifestPath),
    orderManager: requireManifestAddress(entries, "orderManager", manifestPath),
    poolTickBounds: requireManifestAddress(entries, "poolTickBounds", manifestPath),
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
    const protocolDeploymentFile = resolve(
      protocolRoot,
      env.POPCHARTS_PROTOCOL_DEPLOYMENT_FILE || ARC_PROTOCOL_DEPLOYMENT.defaultDeploymentFile,
    );
    const manifestPath = relative(protocolRoot, protocolDeploymentFile);
    let manifest: unknown;
    try {
      manifest = await readJsonFile(protocolDeploymentFile);
    } catch {
      throw new Error(
        "No collateral token configured. Set POPCHARTS_COLLATERAL_ADDRESS " +
          "(pnpm local:deploy-pregrad prints a local MockCollateral address) or provide a " +
          `protocol manifest with a collateral entry at ${manifestPath}.`,
      );
    }
    assertManifestChainId(manifest, manifestPath, chainId);
    collateralAddress = requireManifestAddress(
      collectVenueAddressEntries(manifest),
      "collateral",
      manifestPath,
    );
  }

  await assertBytecode(publicClient, "collateral token", collateralAddress);
  const decimals = await publicClient.readContract({
    abi: erc20Abi,
    address: collateralAddress,
    functionName: "decimals",
  });
  return { address: collateralAddress, decimals };
}

function assertManifestChainId(manifest: unknown, manifestPath: string, chainId: number): void {
  const manifestChainId =
    typeof manifest === "object" && manifest !== null && !Array.isArray(manifest)
      ? (manifest as Record<string, unknown>).chainId
      : undefined;
  if (manifestChainId !== chainId) {
    throw new Error(
      `Manifest ${manifestPath} is for chain ${String(manifestChainId)}, ` +
        `but the connected chain is ${chainId}.`,
    );
  }
}

function requireManifestAddress(
  entries: readonly { address: Address; name: string }[],
  name: string,
  manifestPath: string,
): Address {
  const entry = entries.find((candidate) => candidate.name === name);
  if (entry === undefined) {
    throw new Error(`Manifest ${manifestPath} has no ${name} address entry.`);
  }
  return entry.address;
}

async function assertBytecode(
  publicClient: PublicClient,
  name: string,
  address: Address,
): Promise<void> {
  const bytecode = await publicClient.getCode({ address });
  if (bytecode === undefined || bytecode === "0x") {
    throw new Error(`${name} has no deployed bytecode at ${address}.`);
  }
}
