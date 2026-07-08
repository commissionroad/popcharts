import { getAddress, parseEventLogs } from "viem";

import type { MarketSide, MarketVenueInfo } from "@/domain/markets/types";
import {
  limitOrderDepositWad,
  limitPriceCentsToWad,
  type VenueOrderDirection,
} from "@/domain/postgrad-trading/limit-order";
import {
  buildLimitOrderTickRange,
  displayPriceWadToTick,
  isRestingTickRange,
} from "@/domain/postgrad-trading/limit-order-ticks";
import {
  boundedPoolOrderManagerAbi,
  poolTickBoundsAbi,
  type PostgradVenueContractConfig,
  stateViewSlot0Abi,
  tokenPullerAllowanceAbi,
} from "@/integrations/contracts/postgrad-venue";

import {
  ensureSpendBalance,
  ensureTokenAllowance,
  requireVenueChain,
  type VenuePoolContext,
  type VenueSwapWallet,
} from "./postgrad-swap-service";

const HOOK_DATA_NONE = "0x" as const;

/**
 * Explicit gas limit for the order-manager writes. A resting createOrder settles
 * for ~350k gas (cancelOrder is cheaper), but wallets that fail to estimate fall
 * back to a large default — on the venue chains that default (21M) exceeds the
 * per-transaction gas cap of 2^24 (16,777,216), so the node rejects the tx at
 * submit with a confusing "gas cap" error before it ever runs. Pinning the gas
 * keeps the request well under the cap with ample headroom over real usage.
 */
const ORDER_MANAGER_GAS_LIMIT = 2_000_000n;

/** Transaction-sequence stages of placing a maker order. */
export type VenueLimitOrderStep = "approving" | "confirming" | "placing";

/** Transaction-sequence stages of cancelling a maker order. */
export type VenueCancelOrderStep = "cancelling" | "confirming";

/**
 * Blocking copy for a limit order that would cross the current pool price
 * instead of resting on the book.
 */
export const LIMIT_WOULD_CROSS_MESSAGE =
  "This limit price would fill immediately instead of resting. Move the price away from the current market price, or use a market order.";

/** Blocking copy for a limit price outside the venue's registered band. */
export const LIMIT_PRICE_OUT_OF_BAND_MESSAGE =
  "This limit price sits outside the venue's price band. Choose a price closer to the current market price.";

/** A confirmed resting maker order, read back from the OrderCreated event. */
export type VenueLimitOrderReceipt = {
  /** Exact deposit the pool pulled (collateral for bids, tokens for asks). */
  amountIn: bigint;
  direction: VenueOrderDirection;
  /** Per-pool order id, needed to cancel. */
  orderId: number;
  /** Whole-cent limit price the maker entered. */
  priceCents: number;
  side: MarketSide;
  /** Requested order size in outcome tokens (WAD). */
  sizeWad: bigint;
  transactionHash: `0x${string}`;
};

/**
 * Places a resting limit order on the bounded venue's order manager: maps the
 * whole-cent price to a one-spacing tick range on the maker's side of the
 * pool, verifies the range rests beyond the live pool tick and inside the
 * registered price band, funds it (collateral for bids at size x price,
 * outcome tokens for asks), approves the order manager's token puller, and
 * creates the order. Resolves with the confirmed order read from the
 * OrderCreated event.
 */
export async function placeVenueLimitOrder({
  direction,
  onStep,
  pool,
  poolDisplayPriceWad,
  priceCents,
  side,
  sizeWad,
  venue,
  venueConfig,
  wallet,
}: {
  direction: VenueOrderDirection;
  onStep?: (step: VenueLimitOrderStep) => void;
  pool: VenuePoolContext;
  /** Indexed pool price, the live-tick fallback when StateView is absent. */
  poolDisplayPriceWad: bigint;
  priceCents: number;
  side: MarketSide;
  sizeWad: bigint;
  venue: MarketVenueInfo;
  venueConfig: PostgradVenueContractConfig;
  wallet: VenueSwapWallet;
}): Promise<VenueLimitOrderReceipt> {
  const config = requireVenueChain(wallet);
  const orderManagerAddress = requireOrderManager(venueConfig, venue);
  const priceWad = limitPriceCentsToWad(priceCents);
  const range = buildLimitOrderTickRange({
    direction,
    outcomeIsCurrency0: pool.outcomeIsCurrency0,
    priceWad,
  });

  const currentTick = await readCurrentPoolTick({
    pool,
    poolDisplayPriceWad,
    venueConfig,
    wallet,
  });

  if (!isRestingTickRange({ currentTick, ...range })) {
    throw new Error(LIMIT_WOULD_CROSS_MESSAGE);
  }

  const bounds = (await wallet.publicClient.readContract({
    abi: poolTickBoundsAbi,
    address: venueConfig.poolTickBoundsAddress,
    functionName: "getPoolTickBounds",
    args: [pool.poolId],
  })) as readonly [boolean, number, number];

  if (!bounds[0] || range.tickLower < bounds[1] || range.tickUpper > bounds[2]) {
    throw new Error(LIMIT_PRICE_OUT_OF_BAND_MESSAGE);
  }

  const amountInMaximum = limitOrderDepositWad({ direction, priceWad, sizeWad });
  const spendToken =
    direction === "bid" ? config.collateralAddress : pool.outcomeTokenAddress;
  const spendLabel = direction === "bid" ? "pUSD" : "outcome tokens";

  await ensureSpendBalance({
    amountIn: amountInMaximum,
    spendLabel,
    spendToken,
    wallet,
  });

  // The order manager settles maker deposits through its token puller, so
  // the allowance goes to the puller, not the manager itself.
  const tokenPuller = await wallet.publicClient.readContract({
    abi: boundedPoolOrderManagerAbi,
    address: orderManagerAddress,
    functionName: "tokenPuller",
  });

  await ensureTokenAllowance({
    amountIn: amountInMaximum,
    onStep,
    spender: tokenPuller as `0x${string}`,
    spendToken,
    wallet,
  });

  // A canonical allowance-transfer puller (Permit2 on public chains) pulls the
  // deposit through the order manager's own allowance recorded on the puller,
  // so grant that too. The local mock puller pulls straight through the ERC20
  // approve above and has no allowance surface, so this is a no-op there.
  await ensureOrderManagerPullerAllowance({
    amountIn: amountInMaximum,
    onStep,
    orderManager: orderManagerAddress,
    spendToken,
    tokenPuller: tokenPuller as `0x${string}`,
    wallet,
  });

  onStep?.("placing");
  const hash = await wallet.walletClient.writeContract({
    abi: boundedPoolOrderManagerAbi,
    account: wallet.accountAddress,
    address: orderManagerAddress,
    chain: wallet.walletClient.chain,
    functionName: "createOrder",
    gas: ORDER_MANAGER_GAS_LIMIT,
    args: [
      {
        amountInMaximum,
        enablePartialFill: true,
        hookData: HOOK_DATA_NONE,
        key: pool.poolKey,
        tickLower: range.tickLower,
        tickUpper: range.tickUpper,
        zeroForOne: range.zeroForOne,
      },
    ],
  });

  onStep?.("confirming");
  const receipt = await wallet.publicClient.waitForTransactionReceipt({ hash });
  const createdEvents = parseEventLogs({
    abi: boundedPoolOrderManagerAbi,
    eventName: "OrderCreated",
    logs: receipt.logs.filter((log) => getAddress(log.address) === orderManagerAddress),
  });
  const created = createdEvents[0];

  if (!created) {
    throw new Error("Transaction confirmed but no resting order was recorded.");
  }

  return {
    amountIn: created.args.amountIn,
    direction,
    orderId: created.args.orderId,
    priceCents,
    side,
    sizeWad,
    transactionHash: hash,
  };
}

/** Inventory returned by a confirmed order cancellation. */
export type VenueCancelOrderReceipt = {
  amount0: bigint;
  amount1: bigint;
  orderId: number;
  transactionHash: `0x${string}`;
};

/**
 * Cancels a resting maker order. Cancellation needs no token approval — the
 * order manager returns the order's remaining inventory straight to the
 * maker's wallet.
 */
export async function cancelVenueLimitOrder({
  onStep,
  orderId,
  pool,
  venue,
  venueConfig,
  wallet,
}: {
  onStep?: (step: VenueCancelOrderStep) => void;
  orderId: number;
  pool: VenuePoolContext;
  venue: MarketVenueInfo;
  venueConfig: PostgradVenueContractConfig;
  wallet: VenueSwapWallet;
}): Promise<VenueCancelOrderReceipt> {
  requireVenueChain(wallet);
  const orderManagerAddress = requireOrderManager(venueConfig, venue);

  onStep?.("cancelling");
  const hash = await wallet.walletClient.writeContract({
    abi: boundedPoolOrderManagerAbi,
    account: wallet.accountAddress,
    address: orderManagerAddress,
    chain: wallet.walletClient.chain,
    functionName: "cancelOrder",
    gas: ORDER_MANAGER_GAS_LIMIT,
    args: [pool.poolKey, orderId, HOOK_DATA_NONE],
  });

  onStep?.("confirming");
  const receipt = await wallet.publicClient.waitForTransactionReceipt({ hash });
  const cancelledEvents = parseEventLogs({
    abi: boundedPoolOrderManagerAbi,
    eventName: "OrderCancelled",
    logs: receipt.logs.filter((log) => getAddress(log.address) === orderManagerAddress),
  });
  const cancelled = cancelledEvents[0];

  if (!cancelled) {
    throw new Error("Transaction confirmed but no cancellation was recorded.");
  }

  return {
    amount0: cancelled.args.amount0,
    amount1: cancelled.args.amount1,
    orderId,
    transactionHash: hash,
  };
}

/**
 * The order manager address limit orders transact against: the env-configured
 * address, verified against the venue address the indexer reported so a
 * deployment/config drift fails loudly instead of targeting the wrong
 * contract.
 */
function requireOrderManager(
  venueConfig: PostgradVenueContractConfig,
  venue: MarketVenueInfo
): `0x${string}` {
  const orderManagerAddress = venueConfig.orderManagerAddress;

  if (!orderManagerAddress) {
    throw new Error("Limit orders are not configured on this deployment.");
  }

  if (getAddress(venue.orderManagerAddress) !== orderManagerAddress) {
    throw new Error(
      "The configured order manager no longer matches the indexed venue. Refresh the page; if this persists, the deployed venue and app configuration have drifted."
    );
  }

  return orderManagerAddress;
}

/** How long a granted puller allowance stays valid (30 days), matching the
 * order lifetime a resting maker order expects. */
const PULLER_ALLOWANCE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Grants the order manager the allowance it pulls the deposit through when the
 * puller is a canonical allowance-transfer singleton (Permit2): the singleton
 * moves tokens using the maker's allowance for the order manager, recorded on
 * the singleton, so the ERC20 approve alone is not enough. The `allowance`
 * probe both detects the singleton and reads the standing grant; a mock puller
 * (local devchains) has no such surface, so the read throws and the grant is
 * skipped — its ERC20 allowance is all it needs.
 */
async function ensureOrderManagerPullerAllowance({
  amountIn,
  onStep,
  orderManager,
  spendToken,
  tokenPuller,
  wallet,
}: {
  amountIn: bigint;
  onStep: ((step: VenueLimitOrderStep) => void) | undefined;
  orderManager: `0x${string}`;
  spendToken: `0x${string}`;
  tokenPuller: `0x${string}`;
  wallet: VenueSwapWallet;
}): Promise<void> {
  let standing: readonly [bigint, number, number];

  try {
    standing = (await wallet.publicClient.readContract({
      abi: tokenPullerAllowanceAbi,
      address: tokenPuller,
      functionName: "allowance",
      args: [wallet.accountAddress, spendToken, orderManager],
    })) as readonly [bigint, number, number];
  } catch {
    // Mock puller: no allowance-transfer surface, so the ERC20 approve suffices.
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const [allowed, expiration] = standing;

  if (allowed >= amountIn && expiration > nowSeconds) {
    return;
  }

  onStep?.("approving");
  const hash = await wallet.walletClient.writeContract({
    abi: tokenPullerAllowanceAbi,
    account: wallet.accountAddress,
    address: tokenPuller,
    chain: wallet.walletClient.chain,
    functionName: "approve",
    args: [
      spendToken,
      orderManager,
      amountIn,
      nowSeconds + PULLER_ALLOWANCE_TTL_SECONDS,
    ],
  });
  await wallet.publicClient.waitForTransactionReceipt({ hash });
}

/**
 * The pool's current tick: read live from StateView when configured, else
 * derived from the indexed display price. The derived tick can trail the
 * chain briefly, but the order manager re-validates the order side on-chain,
 * so a stale read fails with the same friendly would-cross copy.
 */
async function readCurrentPoolTick({
  pool,
  poolDisplayPriceWad,
  venueConfig,
  wallet,
}: {
  pool: VenuePoolContext;
  poolDisplayPriceWad: bigint;
  venueConfig: PostgradVenueContractConfig;
  wallet: VenueSwapWallet;
}): Promise<number> {
  if (venueConfig.stateViewAddress) {
    const slot0 = (await wallet.publicClient.readContract({
      abi: stateViewSlot0Abi,
      address: venueConfig.stateViewAddress,
      functionName: "getSlot0",
      args: [pool.poolId],
    })) as readonly [bigint, number, number, number];

    return slot0[1];
  }

  return displayPriceWadToTick({
    displayPriceWad: poolDisplayPriceWad,
    outcomeIsCurrency0: pool.outcomeIsCurrency0,
    rounding: "down",
  });
}
