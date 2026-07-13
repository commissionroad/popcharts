import hre from "hardhat";
import type { network } from "hardhat";
import {
  concatHex,
  encodeAbiParameters,
  getAddress,
  keccak256,
  type Address,
  type Hex,
} from "viem";

import { hasBytecode } from "../deployment/deterministicFactory.js";
import { COMPLETE_SET_PRICE_POLICY } from "../price/completeSetPricePolicy.js";
import { deriveEpsilonBoundTicks } from "../price/deriveEpsilonBoundTicks.js";
import { displayPriceWadToSqrtPriceX96 } from "../price/displayPriceWadToSqrtPriceX96.js";
import { sqrtPriceX96ToTick } from "../price/sqrtPriceX96ToTick.js";

// Minimal ABIs for the vendored v4 venue contracts this flow touches; the
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

type LocalNetworkConnection = Awaited<ReturnType<typeof network.create>>;

type MarketDeployWalletClient = {
  sendTransaction(parameters: { data: Hex }): Promise<Hex>;
  writeContract(parameters: {
    abi: typeof POOL_MANAGER_ABI;
    address: Address;
    args: readonly [PoolKeyStruct, bigint];
    functionName: "initialize";
  }): Promise<Hex>;
};

export type PoolKeyStruct = {
  readonly currency0: Address;
  readonly currency1: Address;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: Address;
};

export type MarketPoolManifestEntry = {
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

export type CompleteSetBinaryMarketDeployment = {
  marketAddress: Address;
  marketDeployHash: Hex;
  noToken: Address;
  yesToken: Address;
};

/**
 * Deploys one standalone CompleteSetBinaryMarket with its YES/NO tokens. This
 * is the one seam where the deploy scripts call the market constructor, so a
 * protocol-side signature change surfaces here first.
 */
export async function deployCompleteSetBinaryMarket({
  collateralAddress,
  connection,
  deployerAddress,
  marketName,
  marketSymbol,
  ownerAddress,
  resolverAddress,
  walletClient,
}: {
  collateralAddress: Address;
  connection: Pick<LocalNetworkConnection, "viem">;
  deployerAddress: Address;
  marketName: string;
  marketSymbol: string;
  ownerAddress: Address;
  resolverAddress: Address;
  walletClient: MarketDeployWalletClient;
}): Promise<CompleteSetBinaryMarketDeployment> {
  const publicClient = await connection.viem.getPublicClient();
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
          { type: "uint64" },
          { type: "uint64" },
        ],
        [
          collateralAddress,
          ownerAddress,
          deployerAddress,
          resolverAddress,
          marketName,
          marketSymbol,
          COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
          // Standalone venue-test market: resolution-time gates disabled (0).
          0n,
          0n,
        ],
      ),
    ]),
  });
  const marketReceipt = await publicClient.waitForTransactionReceipt({ hash: marketDeployHash });
  if (marketReceipt.contractAddress === null || marketReceipt.contractAddress === undefined) {
    throw new Error(`CompleteSetBinaryMarket deployment ${marketDeployHash} created no contract.`);
  }
  const marketAddress = getAddress(marketReceipt.contractAddress);
  if (!(await hasBytecode(publicClient, marketAddress))) {
    throw new Error(`completeSetMarket has no deployed bytecode at ${marketAddress}.`);
  }
  const market = await connection.viem.getContractAt("CompleteSetBinaryMarket", marketAddress);
  const yesToken = getAddress((await market.read.yesToken()) as Address);
  const noToken = getAddress((await market.read.noToken()) as Address);

  return { marketAddress, marketDeployHash, noToken, yesToken };
}

/**
 * Initializes one bounded v4 outcome pool at the target opening display
 * price, configures the ADR 0009 epsilon tick bounds, and whitelists the pool
 * for maker orders. Every write is read back before the pool is recorded in
 * the returned manifest entry.
 */
export async function configureOutcomePool({
  collateral,
  connection,
  openingDisplayPriceWad,
  orderManagerAddress,
  outcomeToken,
  poolTickBoundsAddress,
  side,
  venue,
  walletClient,
}: {
  collateral: { address: Address; decimals: number };
  connection: Pick<LocalNetworkConnection, "viem">;
  openingDisplayPriceWad: bigint;
  orderManagerAddress: Address;
  outcomeToken: Address;
  poolTickBoundsAddress: Address;
  side: "YES" | "NO";
  venue: { boundedHook: Address; poolManager: Address; stateView: Address };
  walletClient: MarketDeployWalletClient;
}): Promise<MarketPoolManifestEntry> {
  const publicClient = await connection.viem.getPublicClient();
  const poolTickBounds = await connection.viem.getContractAt(
    "PoolTickBounds",
    poolTickBoundsAddress,
  );
  const orderManager = await connection.viem.getContractAt(
    "BoundedPoolOrderManager",
    orderManagerAddress,
  );

  // v4 pool keys sort currencies by address, so the outcome token can land
  // on either side of the collateral.
  const outcomeIsCurrency0 = BigInt(outcomeToken) < BigInt(collateral.address);
  const poolKey: PoolKeyStruct = {
    currency0: outcomeIsCurrency0 ? outcomeToken : collateral.address,
    currency1: outcomeIsCurrency0 ? collateral.address : outcomeToken,
    fee: COMPLETE_SET_PRICE_POLICY.poolFee,
    hooks: venue.boundedHook,
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
}
