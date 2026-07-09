import type { Market, MarketSide } from "@/domain/markets/types";
import {
  DEFAULT_RECEIPT_SLIPPAGE_BPS,
  MAX_RECEIPT_BUDGET_USD,
  type ReceiptQuotePreview,
} from "@/domain/pregrad-trading/receipt-quote";
import type { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { presentError } from "@/lib/error-handling";

import type { TradingEnvironment } from "./place-receipt-service";

/**
 * What the receipt ticket's primary button should do right now: its label,
 * whether it is disabled, and the click handler (undefined when the ticket is
 * blocked with nothing actionable).
 */
export type ReceiptAction = {
  disabled: boolean;
  label: string;
  onClick: (() => void) | undefined;
};

/**
 * Derives the receipt ticket's primary action from market, quote, wallet, and
 * client state, checked in blocking order: market status, in-flight placement,
 * quote validity, then (for contract trading) wallet connection, chain, client
 * readiness, market existence, and balance. Ends at "place receipt" only when
 * nothing blocks placement.
 */
export function getReceiptAction({
  amountError,
  contractMarketMissing,
  environment,
  insufficientBalance,
  isPlacing,
  marketStatus,
  onPlace,
  publicClientReady,
  quote,
  side,
  wallet,
  walletClientReady,
}: {
  amountError: string | null;
  contractMarketMissing: boolean;
  environment: TradingEnvironment;
  insufficientBalance: boolean;
  isPlacing: boolean;
  marketStatus: Market["status"];
  onPlace: () => void;
  publicClientReady: boolean;
  quote: ReceiptQuotePreview | null;
  side: MarketSide;
  wallet: ReturnType<typeof useWalletAccount>;
  walletClientReady: boolean;
}): ReceiptAction {
  const sideLabel = side === "yes" ? "YES" : "NO";

  if (marketStatus !== "bootstrap") {
    return {
      disabled: true,
      label: "Receipt book locked",
      onClick: undefined,
    };
  }

  if (isPlacing) {
    return {
      disabled: true,
      label: "Placing receipt",
      onClick: undefined,
    };
  }

  if (amountError || !quote) {
    return {
      disabled: true,
      label: `Place ${sideLabel} receipt`,
      onClick: undefined,
    };
  }

  if (environment.kind === "mock") {
    return {
      disabled: false,
      label: `Place mock ${sideLabel} receipt`,
      onClick: onPlace,
    };
  }

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
      label: "Sign in to place receipt",
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

  if (contractMarketMissing) {
    return {
      disabled: true,
      label: "Market not on current contract",
      onClick: undefined,
    };
  }

  if (insufficientBalance) {
    return {
      disabled: true,
      label: "Insufficient pUSD",
      onClick: undefined,
    };
  }

  return {
    disabled: false,
    label: `Place ${sideLabel} receipt`,
    onClick: onPlace,
  };
}

/**
 * Translates a receipt placement failure into user-facing copy, mapping the
 * PregradManager MarketDoesNotExist revert (including its raw selector) to a
 * stale-devchain explanation instead of surfacing the raw error.
 */
export function getReceiptPlacementErrorMessage(error: unknown) {
  return presentError(error, {
    context: { operation: "receipt-placement" },
    fallback: "Could not place receipt.",
    matcher: (placementError) =>
      placementError.message.includes("MarketDoesNotExist") ||
      placementError.message.includes("0x7ff80d38")
        ? "This market is not available on the current PregradManager. Create a new local market and try again."
        : undefined,
  });
}

/**
 * Budget filled in by the "Max" preset: the wallet's pUSD balance discounted
 * by the default slippage buffer so the resulting max cost stays affordable,
 * capped at the per-receipt budget limit. Falls back to 5,000 when the
 * balance is unknown.
 */
export function getMaxPresetAmount(balanceUsd: number | null) {
  if (balanceUsd === null) {
    return 5_000;
  }

  const slippageMultiplier = 1 + DEFAULT_RECEIPT_SLIPPAGE_BPS / 10_000;

  return Math.max(0, Math.min(MAX_RECEIPT_BUDGET_USD, balanceUsd / slippageMultiplier));
}
