import {
  COMPLETE_SET_PRICE_POLICY,
  clampDisplayPriceWad,
  completeSetBinaryMarketAbi,
  boundedPoolOrderManagerAbi,
  deriveEpsilonBoundTicks,
  displayPriceWadToSqrtPriceX96,
  poolTickBoundsAbi,
} from "@popcharts/protocol";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  type Hash,
} from "viem";

import type { MarketVenuePoolResponse, MarketVenueResponse } from "src/api/models/markets";
import { config, ZERO_ADDRESS } from "src/config";

/**
 * Wires graduated markets into the bounded v4 venue. The postgrad adapter
 * deliberately stops at deploying the complete-set market (ADR 0007), so this
 * service performs the venue side of the handoff the demo-market script does
 * for operator-created markets: initialize the YES and NO outcome pools,
 * register the ADR 0009 epsilon tick bounds, and whitelist both pools with
 * the bounded order manager so swaps and maker orders can run.
 */

const WAD = 10n ** 18n;

const POOL_MANAGER_ABI = parseAbi([
  "function initialize((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks) key, uint160 sqrtPriceX96) returns (int24)",
]);
const STATE_VIEW_ABI = parseAbi([
  "function getSlot0(bytes32 poolId) view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)",
]);
const ERC20_DECIMALS_ABI = parseAbi([
  "function decimals() view returns (uint8)",
]);

/** A v4 pool key for one outcome token traded against market collateral. */
export type OutcomePoolKey = {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  hooks: `0x${string}`;
  tickSpacing: number;
};

/** Returns true when every venue contract this service calls is configured. */
export function postgradVenueConfigured(): boolean {
  return (
    config.contracts.boundedHook !== ZERO_ADDRESS &&
    config.contracts.orderManager !== ZERO_ADDRESS &&
    config.contracts.poolManager !== ZERO_ADDRESS &&
    config.contracts.poolTickBounds !== ZERO_ADDRESS &&
    config.contracts.stateView !== ZERO_ADDRESS
  );
}

/** Builds the sorted v4 pool key for an outcome token against collateral. */
export function buildOutcomePoolKey({
  collateral,
  outcomeToken,
}: {
  collateral: `0x${string}`;
  outcomeToken: `0x${string}`;
}): { key: OutcomePoolKey; outcomeIsCurrency0: boolean } {
  const outcomeIsCurrency0 =
    BigInt(outcomeToken.toLowerCase()) < BigInt(collateral.toLowerCase());

  return {
    key: {
      currency0: outcomeIsCurrency0 ? outcomeToken : collateral,
      currency1: outcomeIsCurrency0 ? collateral : outcomeToken,
      fee: COMPLETE_SET_PRICE_POLICY.poolFee,
      hooks: config.contracts.boundedHook,
      tickSpacing: COMPLETE_SET_PRICE_POLICY.tickSpacing,
    },
    outcomeIsCurrency0,
  };
}

/** Computes the v4 pool id: keccak256 of the ABI-encoded pool key. */
export function computePoolId(key: OutcomePoolKey): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [
        {
          components: [
            { name: "currency0", type: "address" },
            { name: "currency1", type: "address" },
            { name: "fee", type: "uint24" },
            { name: "tickSpacing", type: "int24" },
            { name: "hooks", type: "address" },
          ],
          type: "tuple",
        },
      ],
      [
        {
          currency0: key.currency0,
          currency1: key.currency1,
          fee: key.fee,
          hooks: key.hooks,
          tickSpacing: key.tickSpacing,
        },
      ],
    ),
  );
}

/**
 * Derives the market's closing YES probability from its locked virtual LMSR
 * state, clamped into the ADR 0009 display-price band. The postgrad pools
 * open where the pregrad book closed, so the handoff does not jump price.
 */
export function closingYesDisplayPriceWad({
  liquidityParameter,
  noShares,
  openingProbabilityWad,
  yesShares,
}: {
  liquidityParameter: bigint;
  noShares: bigint;
  openingProbabilityWad: bigint;
  yesShares: bigint;
}): bigint {
  const b = wadToNumber(liquidityParameter);
  const opening = Math.min(Math.max(wadToNumber(openingProbabilityWad), 1e-9), 1 - 1e-9);

  if (!(b > 0)) {
    return clampDisplayPriceWad(openingProbabilityWad);
  }

  const exponent =
    (wadToNumber(yesShares) - wadToNumber(noShares)) / b +
    Math.log(opening / (1 - opening));
  const probability = 1 / (1 + Math.exp(-exponent));

  return clampDisplayPriceWad(BigInt(Math.round(probability * 1e18)));
}

type VenueClients = {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
};

type WiredPool = {
  initialized: boolean;
  outcomeToken: `0x${string}`;
  poolId: `0x${string}`;
  transactionHashes: Hash[];
  whitelisted: boolean;
};

/**
 * Reads the outcome tokens from a prepared postgrad market and wires both of
 * its pools into the venue. Every step is idempotent — already-initialized
 * pools, configured bounds, and whitelisted pools are left untouched — so a
 * resumed graduation heals whatever is missing.
 */
export async function wirePostgradMarketVenue({
  clients,
  collateral,
  postgradMarket,
  yesDisplayPriceWad,
}: {
  clients: VenueClients;
  collateral: `0x${string}`;
  postgradMarket: `0x${string}`;
  yesDisplayPriceWad: bigint;
}): Promise<{ pools: { no: WiredPool; yes: WiredPool }; transactionHashes: Hash[] }> {
  const { publicClient } = clients;
  const [yesToken, noToken] = await Promise.all([
    publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: postgradMarket,
      functionName: "yesToken",
    }),
    publicClient.readContract({
      abi: completeSetBinaryMarketAbi,
      address: postgradMarket,
      functionName: "noToken",
    }),
  ]);
  const collateralDecimals = await publicClient.readContract({
    abi: ERC20_DECIMALS_ABI,
    address: collateral,
    functionName: "decimals",
  });
  const noDisplayPriceWad = clampDisplayPriceWad(WAD - yesDisplayPriceWad);

  const yes = await wireOutcomePool({
    clients,
    collateral,
    collateralDecimals,
    displayPriceWad: clampDisplayPriceWad(yesDisplayPriceWad),
    outcomeToken: yesToken as `0x${string}`,
  });
  const no = await wireOutcomePool({
    clients,
    collateral,
    collateralDecimals,
    displayPriceWad: noDisplayPriceWad,
    outcomeToken: noToken as `0x${string}`,
  });

  return {
    pools: { no, yes },
    transactionHashes: [...yes.transactionHashes, ...no.transactionHashes],
  };
}

async function wireOutcomePool({
  clients,
  collateral,
  collateralDecimals,
  displayPriceWad,
  outcomeToken,
}: {
  clients: VenueClients;
  collateral: `0x${string}`;
  collateralDecimals: number;
  displayPriceWad: bigint;
  outcomeToken: `0x${string}`;
}): Promise<WiredPool> {
  const { publicClient, walletClient } = clients;
  const { key, outcomeIsCurrency0 } = buildOutcomePoolKey({
    collateral,
    outcomeToken,
  });
  const poolId = computePoolId(key);
  const orientation = {
    collateralDecimals,
    outcomeDecimals: COMPLETE_SET_PRICE_POLICY.outcomeDecimals,
    outcomeIsCurrency0,
  };
  const transactionHashes: Hash[] = [];
  const write = async (
    address: `0x${string}`,
    abi: readonly unknown[],
    functionName: string,
    args: unknown[],
  ) => {
    const hash = await walletClient.writeContract({
      abi: abi as [],
      account: walletClient.account!,
      address,
      args: args as [],
      chain: config.chain,
      functionName,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status !== "success") {
      throw new Error(`${functionName} transaction failed: ${hash}`);
    }

    transactionHashes.push(hash);
  };

  const [slot0, bounds, whitelisted] = await Promise.all([
    publicClient.readContract({
      abi: STATE_VIEW_ABI,
      address: config.contracts.stateView,
      functionName: "getSlot0",
      args: [poolId],
    }),
    publicClient.readContract({
      abi: poolTickBoundsAbi,
      address: config.contracts.poolTickBounds,
      functionName: "getPoolTickBounds",
      args: [poolId],
    }) as Promise<readonly [boolean, number, number]>,
    publicClient.readContract({
      abi: boundedPoolOrderManagerAbi,
      address: config.contracts.orderManager,
      functionName: "poolWhitelisted",
      args: [poolId],
    }) as Promise<boolean>,
  ]);

  const epsilonBounds = deriveEpsilonBoundTicks(orientation);

  // Bounds must exist before the first swap-adjacent action; write them ahead
  // of pool initialization so the hook can validate the opening tick.
  if (!bounds[0]) {
    await write(
      config.contracts.poolTickBounds,
      poolTickBoundsAbi,
      "setPoolTickBounds",
      [poolId, epsilonBounds.lowerTick, epsilonBounds.upperTick],
    );
  }

  if ((slot0 as readonly [bigint, number, number, number])[0] === 0n) {
    await write(config.contracts.poolManager, POOL_MANAGER_ABI, "initialize", [
      key,
      displayPriceWadToSqrtPriceX96({ ...orientation, displayPriceWad }),
    ]);
  }

  if (!whitelisted) {
    await write(
      config.contracts.orderManager,
      boundedPoolOrderManagerAbi,
      "setPoolWhitelisted",
      [key, true],
    );
  }

  return {
    initialized: true,
    outcomeToken,
    poolId,
    transactionHashes,
    whitelisted: true,
  };
}

/**
 * Reads the venue state for a prepared postgrad market so the API can report
 * whether trading is live and where. Returns null when the venue is not
 * configured or the reads fail (e.g. a market graduated before the venue
 * existed).
 */
export async function readPostgradMarketVenue({
  collateral,
  postgradMarket,
}: {
  collateral: `0x${string}`;
  postgradMarket: `0x${string}`;
}): Promise<MarketVenueResponse | null> {
  if (!postgradVenueConfigured()) {
    return null;
  }

  const publicClient = getVenuePublicClient();

  try {
    const [yesToken, noToken] = await Promise.all([
      publicClient.readContract({
        abi: completeSetBinaryMarketAbi,
        address: postgradMarket,
        functionName: "yesToken",
      }),
      publicClient.readContract({
        abi: completeSetBinaryMarketAbi,
        address: postgradMarket,
        functionName: "noToken",
      }),
    ]);
    const [yesPool, noPool] = await Promise.all([
      readOutcomePool({ collateral, outcomeToken: yesToken as `0x${string}`, publicClient }),
      readOutcomePool({ collateral, outcomeToken: noToken as `0x${string}`, publicClient }),
    ]);

    return {
      boundedHookAddress: config.contracts.boundedHook,
      live: yesPool.initialized && yesPool.whitelisted && noPool.initialized && noPool.whitelisted,
      noPool,
      orderManagerAddress: config.contracts.orderManager,
      poolManagerAddress: config.contracts.poolManager,
      yesPool,
    };
  } catch (error) {
    console.warn(
      `[Postgrad venue] Could not read venue state for ${postgradMarket}:`,
      error,
    );
    return null;
  }
}

async function readOutcomePool({
  collateral,
  outcomeToken,
  publicClient,
}: {
  collateral: `0x${string}`;
  outcomeToken: `0x${string}`;
  publicClient: ReturnType<typeof createPublicClient>;
}): Promise<MarketVenuePoolResponse> {
  const { key } = buildOutcomePoolKey({ collateral, outcomeToken });
  const poolId = computePoolId(key);
  const [slot0, whitelisted] = await Promise.all([
    publicClient.readContract({
      abi: STATE_VIEW_ABI,
      address: config.contracts.stateView,
      functionName: "getSlot0",
      args: [poolId],
    }),
    publicClient.readContract({
      abi: boundedPoolOrderManagerAbi,
      address: config.contracts.orderManager,
      functionName: "poolWhitelisted",
      args: [poolId],
    }) as Promise<boolean>,
  ]);

  return {
    initialized: (slot0 as readonly [bigint, number, number, number])[0] !== 0n,
    outcomeTokenAddress: outcomeToken.toLowerCase(),
    poolId,
    whitelisted,
  };
}

function wadToNumber(value: bigint): number {
  return Number(value) / 1e18;
}

let venuePublicClient: ReturnType<typeof createPublicClient> | null = null;

function getVenuePublicClient() {
  venuePublicClient ??= createPublicClient({
    chain: config.chain,
    transport: http(config.rpcHttpUrl),
  });

  return venuePublicClient;
}
