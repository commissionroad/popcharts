import type {
  VenueSwapQuote,
  VenueTradeAction,
} from "@/domain/postgrad-trading/venue-trade";
import type { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { getErrorMessage } from "@/lib/error-handling";

import type { VenueTradingEnvironment } from "./postgrad-swap-service";

/**
 * What the postgrad ticket's primary button should do right now: its label,
 * whether it is disabled, and the click handler (undefined when the ticket is
 * blocked with nothing actionable).
 */
export type VenueSwapAction = {
  disabled: boolean;
  label: string;
  onClick: (() => void) | undefined;
};

/**
 * Copy shown when a trade (or its quote) would push the pool past the ADR
 * 0009 epsilon price bound enforced by the bounded hook.
 */
export const PRICE_BOUND_REACHED_MESSAGE =
  "Price bound reached: this order would push the pool past the venue's price band. Try a smaller amount.";

/**
 * Non-blocking notice shown when the quoter reports the order would cross the
 * price band. The actual swap's price limit sits at the band edge, so the
 * order still executes — it just stops early instead of reverting.
 */
export const PRICE_BOUND_QUOTE_WARNING =
  "Price bound reached: this order is bigger than the pool can fill inside its price band. It will stop at the band edge and the unspent remainder stays in your wallet.";

/**
 * True when a swap or quote failure is the bounded hook's PoolTickOutOfBounds
 * revert (by name or raw selector).
 */
export function isPriceBoundError(error: unknown) {
  return (
    error instanceof Error &&
    (error.message.includes("PoolTickOutOfBounds") ||
      error.message.includes(POOL_TICK_OUT_OF_BOUNDS_SELECTOR))
  );
}

/**
 * Selector of PoolTickBounds.PoolTickOutOfBounds(bytes32,int24,int24,int24),
 * without a 0x prefix: the quoter and pool manager wrap hook reverts in
 * carrier errors whose raw bytes embed this selector mid-string.
 */
export const POOL_TICK_OUT_OF_BOUNDS_SELECTOR = "16996a81";

/**
 * Derives the ticket's primary action from quote, wallet, and client state,
 * checked in blocking order: in-flight swap, amount validity, mock preview,
 * then wallet connection, chain, client readiness, and balance. Ends at the
 * buy/sell action only when nothing blocks the swap.
 */
export function getVenueSwapAction({
  action,
  amountError,
  environment,
  insufficientBalance,
  isSwapping,
  onSwap,
  publicClientReady,
  quote,
  sideLabel,
  wallet,
  walletClientReady,
}: {
  action: VenueTradeAction;
  amountError: string | null;
  environment: VenueTradingEnvironment;
  insufficientBalance: boolean;
  isSwapping: boolean;
  onSwap: () => void;
  publicClientReady: boolean;
  quote: VenueSwapQuote | null;
  sideLabel: string;
  wallet: ReturnType<typeof useWalletAccount>;
  walletClientReady: boolean;
}): VenueSwapAction {
  const tradeLabel = `${action === "buy" ? "Buy" : "Sell"} ${sideLabel} tokens`;

  if (isSwapping) {
    return {
      disabled: true,
      label: "Placing order",
      onClick: undefined,
    };
  }

  if (amountError || !quote) {
    return {
      disabled: true,
      label: tradeLabel,
      onClick: undefined,
    };
  }

  if (environment.kind === "mock") {
    // Postgrad fills are real, immediate settlements, so unlike the pregrad
    // ticket the fixture preview does not simulate them.
    return {
      disabled: true,
      label: "Preview only - no venue connected",
      onClick: undefined,
    };
  }

  const walletGate = getVenueWalletGate({
    publicClientReady,
    wallet,
    walletClientReady,
  });

  if (walletGate) {
    return walletGate;
  }

  if (insufficientBalance) {
    return {
      disabled: true,
      label:
        action === "buy" ? "Insufficient pUSD" : `Insufficient ${sideLabel} tokens`,
      onClick: undefined,
    };
  }

  return {
    disabled: false,
    label: tradeLabel,
    onClick: onSwap,
  };
}

/**
 * The shared wallet-and-client gating sequence for venue transactions:
 * sign-in availability, wallet readiness, authentication, wallet linkage,
 * chain, and viem client readiness, checked in blocking order. Returns null
 * when nothing blocks, so callers continue to their own trade-specific
 * checks.
 */
export function getVenueWalletGate({
  publicClientReady,
  wallet,
  walletClientReady,
}: {
  publicClientReady: boolean;
  wallet: ReturnType<typeof useWalletAccount>;
  walletClientReady: boolean;
}): VenueSwapAction | null {
  if (!wallet.enabled) {
    return {
      disabled: true,
      label: "Sign in unavailable",
      onClick: undefined,
    };
  }

  if (!wallet.ready) {
    return {
      disabled: true,
      label: "Preparing wallet",
      onClick: undefined,
    };
  }

  if (!wallet.authenticated) {
    return {
      disabled: false,
      label: "Sign in to trade",
      onClick: wallet.login,
    };
  }

  if (!wallet.address) {
    return {
      disabled: false,
      label: "Create or link wallet",
      onClick: wallet.connectOrCreateWallet,
    };
  }

  if (!wallet.isSupportedChain) {
    return {
      disabled: Boolean(wallet.pendingAction),
      label: `Switch to ${wallet.defaultChain.name}`,
      onClick: () => void wallet.switchChain(wallet.defaultChain.id),
    };
  }

  if (!publicClientReady || !walletClientReady) {
    return {
      disabled: true,
      label: "Preparing trading client",
      onClick: undefined,
    };
  }

  return null;
}

/**
 * Translates a venue swap or quote failure into user-facing copy, mapping the
 * bounded hook's PoolTickOutOfBounds revert (including its raw selector) to
 * the friendly price-bound explanation instead of surfacing the raw error.
 */
export function getVenueSwapErrorMessage(error: unknown) {
  return getErrorMessage(error, {
    fallback: "Could not place the order.",
    matcher: (swapError) =>
      isPriceBoundError(swapError) ? PRICE_BOUND_REACHED_MESSAGE : undefined,
  });
}

/**
 * Amount filled in by the "Max" preset: the spend-token balance (collateral
 * for buys, the selected side's outcome tokens for sells), capped at the
 * per-trade limit. Falls back to 5,000 while the balance is unknown.
 */
export function getMaxVenueTradeAmount({
  balance,
  maxAmount,
}: {
  balance: number | null;
  maxAmount: number;
}) {
  if (balance === null) {
    return 5_000;
  }

  return Math.max(0, Math.min(maxAmount, balance));
}
