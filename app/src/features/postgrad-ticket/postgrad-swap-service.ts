import type { PublicClient, WalletClient } from "viem";
import { getAddress, parseEventLogs } from "viem";

import type { Market, MarketSide, MarketVenueInfo } from "@/domain/markets/types";
import type { VenueTradeAction } from "@/domain/postgrad-trading/venue-trade";
import type { PopChartsContractConfig } from "@/integrations/contracts/config";
import { getPopChartsContractConfig } from "@/integrations/contracts/config";
import { erc20Abi } from "@/integrations/contracts/erc20";
import {
  buildVenuePoolKey,
  computeVenuePoolId,
  getPostgradVenueContractConfig,
  minimalV4SwapRouterAbi,
  poolManagerSwapEventAbi,
  poolTickBoundsAbi,
  type PostgradVenueContractConfig,
  tickToSqrtPriceX96,
  v4QuoterAbi,
  type VenuePoolKey,
} from "@/integrations/contracts/postgrad-venue";
import { formatTokenAmount } from "@/lib/format";

/**
 * Connected wallet context required for venue swaps: the signing account, its
 * active chain, and viem clients bound to the devchain.
 */
export type VenueSwapWallet = {
  accountAddress: `0x${string}`;
  activeChainId: number | null;
  publicClient: PublicClient;
  walletClient: WalletClient;
};

/**
 * The transaction-sequence stages a venue swap moves through, reported via
 * `onStep` so the ticket can show progress.
 */
export type VenueSwapStep = "approving" | "confirming" | "swapping";

/**
 * Where a graduated market's outcome tokens trade: against the deployed
 * bounded venue contracts, or as a fixture-backed preview with no chain
 * behind it.
 */
export type VenueTradingEnvironment =
  | {
      config: PopChartsContractConfig;
      kind: "contract";
      venue: MarketVenueInfo;
      venueConfig: PostgradVenueContractConfig;
    }
  | { kind: "mock" };

/**
 * One side's resolved v4 pool: the reconstructed pool key, its id (verified
 * against the indexed venue payload), and the currency orientation that
 * decides swap direction.
 */
export type VenuePoolContext = {
  outcomeIsCurrency0: boolean;
  outcomeTokenAddress: `0x${string}`;
  poolId: `0x${string}`;
  poolKey: VenuePoolKey;
};

/** A confirmed venue fill, with the actual amounts read from the Swap event. */
export type VenueSwapReceipt = {
  action: VenueTradeAction;
  /** Exact input actually consumed by the pool. */
  amountIn: bigint;
  /** Output amount delivered to the wallet. */
  amountOut: bigint;
  /**
   * True when the pool stopped at the venue's price bound before consuming
   * the full input, leaving the remainder unspent in the wallet.
   */
  partialFill: boolean;
  /** Input amount the order asked to spend. */
  requestedIn: bigint;
  side: MarketSide;
  transactionHash: `0x${string}`;
};

/**
 * Decides whether a graduated market's venue trades against the configured
 * devchain contracts or stays a fixture preview. Contract trading needs the
 * base contract config, the venue contract addresses (swap router and tick
 * bounds), an indexed live venue, and a market on the configured chain.
 */
export function resolveVenueTradingEnvironment(
  market: Market
): VenueTradingEnvironment {
  const config = getPopChartsContractConfig();
  const venueConfig = getPostgradVenueContractConfig();
  const venue = market.postgrad?.venue;

  if (config && venueConfig && venue?.live && market.chainId === config.chainId) {
    return { config, kind: "contract", venue, venueConfig };
  }

  return { kind: "mock" };
}

/**
 * Reconstructs the v4 pool key for one side of a live venue and verifies it
 * hashes to the pool id the indexer reported. A mismatch means the app's
 * policy constants or hook address drifted from what was deployed, so trading
 * against the reconstructed key would target a nonexistent pool.
 */
export function buildVenuePoolContext({
  collateral,
  side,
  venue,
}: {
  collateral: `0x${string}`;
  side: MarketSide;
  venue: MarketVenueInfo;
}): VenuePoolContext {
  const pool = side === "yes" ? venue.yesPool : venue.noPool;
  const outcomeTokenAddress = getAddress(pool.outcomeTokenAddress);
  const { key, outcomeIsCurrency0 } = buildVenuePoolKey({
    boundedHook: getAddress(venue.boundedHookAddress),
    collateral,
    outcomeToken: outcomeTokenAddress,
  });
  const poolId = computeVenuePoolId(key);

  if (poolId.toLowerCase() !== pool.poolId.toLowerCase()) {
    throw new Error(
      "The venue pool key no longer matches the indexed pool. Refresh the page; if this persists, the deployed venue and app configuration have drifted."
    );
  }

  return { outcomeIsCurrency0, outcomeTokenAddress, poolId, poolKey: key };
}

/**
 * Swap direction for a trade on one outcome pool: buys pay collateral in,
 * sells pay outcome tokens in, and `zeroForOne` follows from which currency
 * sorted first in the pool key.
 */
export function venueSwapDirection({
  action,
  outcomeIsCurrency0,
}: {
  action: VenueTradeAction;
  outcomeIsCurrency0: boolean;
}) {
  return action === "buy" ? !outcomeIsCurrency0 : outcomeIsCurrency0;
}

/**
 * Asks the deployed v4 quoter for the exact output of an exact-input swap.
 * Returns null when no quoter is configured, so callers fall back to the
 * pool-price estimate. Reverts from the quoter (including the bounded hook's
 * PoolTickOutOfBounds) propagate to the caller.
 */
export async function quoteVenueSwap({
  action,
  amountIn,
  pool,
  publicClient,
  venueConfig,
}: {
  action: VenueTradeAction;
  amountIn: bigint;
  pool: VenuePoolContext;
  publicClient: PublicClient;
  venueConfig: PostgradVenueContractConfig;
}): Promise<bigint | null> {
  if (!venueConfig.quoterAddress) {
    return null;
  }

  const { result } = await publicClient.simulateContract({
    abi: v4QuoterAbi,
    address: venueConfig.quoterAddress,
    functionName: "quoteExactInputSingle",
    args: [
      {
        exactAmount: amountIn,
        hookData: "0x",
        poolKey: pool.poolKey,
        zeroForOne: venueSwapDirection({
          action,
          outcomeIsCurrency0: pool.outcomeIsCurrency0,
        }),
      },
    ],
  });

  return result[0];
}

/**
 * Places a market order on the bounded venue: checks the wallet's chain and
 * spend-token balance, tops up the router's allowance when it is short, then
 * swaps exact input through the minimal v4 router with the price limit pinned
 * at the pool's epsilon tick bound (the keeper's convention, ADR 0009). The
 * bound limit means an oversized order stops at the band edge as a partial
 * fill instead of reverting. Resolves with the actual fill read from the
 * PoolManager Swap event.
 */
export async function placeVenueSwap({
  action,
  amountIn,
  onStep,
  pool,
  side,
  venueConfig,
  wallet,
}: {
  action: VenueTradeAction;
  amountIn: bigint;
  onStep?: (step: VenueSwapStep) => void;
  pool: VenuePoolContext;
  side: MarketSide;
  venueConfig: PostgradVenueContractConfig;
  wallet: VenueSwapWallet;
}): Promise<VenueSwapReceipt> {
  const config = getPopChartsContractConfig();

  if (!config) {
    throw new Error("Venue contracts are not configured.");
  }

  if (wallet.activeChainId !== config.chainId) {
    throw new Error(`Switch your wallet to chain ${config.chainId}.`);
  }

  const zeroForOne = venueSwapDirection({
    action,
    outcomeIsCurrency0: pool.outcomeIsCurrency0,
  });
  const spendToken =
    action === "buy" ? config.collateralAddress : pool.outcomeTokenAddress;
  const spendLabel = action === "buy" ? "pUSD" : "outcome tokens";
  const balance = await wallet.publicClient.readContract({
    abi: erc20Abi,
    address: spendToken,
    functionName: "balanceOf",
    args: [wallet.accountAddress],
  });

  if (balance < amountIn) {
    throw new Error(
      `Insufficient balance. You have ${formatTokenAmount(
        balance
      )} ${spendLabel}, but this order spends ${formatTokenAmount(amountIn)}.`
    );
  }

  const bounds = (await wallet.publicClient.readContract({
    abi: poolTickBoundsAbi,
    address: venueConfig.poolTickBoundsAddress,
    functionName: "getPoolTickBounds",
    args: [pool.poolId],
  })) as readonly [boolean, number, number];

  if (!bounds[0]) {
    throw new Error(
      "This pool has no registered price bounds yet, so the venue cannot accept swaps."
    );
  }

  await ensureRouterAllowance({
    amountIn,
    onStep,
    routerAddress: venueConfig.swapRouterAddress,
    spendToken,
    wallet,
  });

  onStep?.("swapping");
  // A zeroForOne swap walks the price down toward the lower bound tick; the
  // opposite direction walks it up toward the upper bound.
  const limitTick = zeroForOne ? bounds[1] : bounds[2];
  const hash = await wallet.walletClient.writeContract({
    abi: minimalV4SwapRouterAbi,
    account: wallet.accountAddress,
    address: venueConfig.swapRouterAddress,
    chain: wallet.walletClient.chain,
    functionName: "swap",
    args: [
      pool.poolKey,
      {
        amountSpecified: -amountIn,
        sqrtPriceLimitX96: tickToSqrtPriceX96(limitTick),
        zeroForOne,
      },
      wallet.accountAddress,
      "0x",
    ],
  });

  onStep?.("confirming");
  const transactionReceipt = await wallet.publicClient.waitForTransactionReceipt({
    hash,
  });
  const swapLogs = parseEventLogs({
    abi: poolManagerSwapEventAbi,
    eventName: "Swap",
    logs: transactionReceipt.logs,
  });
  const swapEvent = swapLogs.find(
    (log) => log.args.id.toLowerCase() === pool.poolId.toLowerCase()
  );

  if (!swapEvent) {
    throw new Error("Transaction confirmed but no venue fill was recorded.");
  }

  // The Swap event carries the swapper's balance delta: the input currency is
  // negative, the output currency positive.
  const inputDelta = zeroForOne ? swapEvent.args.amount0 : swapEvent.args.amount1;
  const outputDelta = zeroForOne ? swapEvent.args.amount1 : swapEvent.args.amount0;
  const actualIn = inputDelta < 0n ? -inputDelta : inputDelta;
  const actualOut = outputDelta < 0n ? -outputDelta : outputDelta;

  return {
    action,
    amountIn: actualIn,
    amountOut: actualOut,
    partialFill: actualIn < amountIn,
    requestedIn: amountIn,
    side,
    transactionHash: hash,
  };
}

async function ensureRouterAllowance({
  amountIn,
  onStep,
  routerAddress,
  spendToken,
  wallet,
}: {
  amountIn: bigint;
  onStep: ((step: VenueSwapStep) => void) | undefined;
  routerAddress: `0x${string}`;
  spendToken: `0x${string}`;
  wallet: VenueSwapWallet;
}) {
  const allowance = await wallet.publicClient.readContract({
    abi: erc20Abi,
    address: spendToken,
    functionName: "allowance",
    args: [wallet.accountAddress, routerAddress],
  });

  if (allowance >= amountIn) {
    return;
  }

  onStep?.("approving");
  const approvalHash = await wallet.walletClient.writeContract({
    abi: erc20Abi,
    account: wallet.accountAddress,
    address: spendToken,
    chain: wallet.walletClient.chain,
    functionName: "approve",
    args: [routerAddress, amountIn],
  });

  await wallet.publicClient.waitForTransactionReceipt({ hash: approvalHash });
}
