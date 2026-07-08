import type { useWalletAccount } from "@/integrations/wallet/wallet-provider";
import { getErrorMessage } from "@/lib/error-handling";

import {
  LIMIT_PRICE_OUT_OF_BAND_MESSAGE,
  LIMIT_WOULD_CROSS_MESSAGE,
} from "./limit-order-service";
import type { VenueTradingEnvironment } from "./postgrad-swap-service";
import {
  getVenueWalletGate,
  isPriceBoundError,
  type VenueSwapAction,
} from "./swap-action";

/**
 * Order-manager revert names and selectors mapped to friendly copy. Carrier
 * errors from viem can embed only the raw 4-byte selector mid-string, so both
 * forms are matched (same convention as the price-bound matcher). Selectors
 * are keccak-derived from the BoundedPoolOrderManager error signatures.
 */
const LIMIT_ORDER_ERROR_COPY: readonly {
  match: readonly string[];
  message: string;
}[] = [
  {
    // InvalidOrderSide(bool,int24,int24,int24): the range does not rest
    // beyond the current tick — the order would fill immediately.
    match: ["InvalidOrderSide", "fb6bb2a5"],
    message: LIMIT_WOULD_CROSS_MESSAGE,
  },
  {
    // InvalidAmount(): zero or below the venue's per-token minimum.
    match: ["InvalidAmount", "2c5211c6"],
    message: "This order is below the venue's minimum order size. Increase the size.",
  },
  {
    // InvalidLiquidity(): the deposit rounds to zero pool liquidity.
    match: ["InvalidLiquidity", "1fff9681"],
    message: "This order is too small to rest at that price. Increase the size.",
  },
  {
    // OrderNotFound(bytes32,uint32): cancelling an order that already left
    // the book.
    match: ["OrderNotFound", "a0b1d457"],
    message: "This order has already been filled or cancelled.",
  },
];

/**
 * Translates a limit-order placement or cancellation failure into user-facing
 * copy: order-manager reverts (by name or raw selector) map to friendly
 * explanations, and the bounded hook's price-band revert maps to the band
 * message.
 */
export function getLimitOrderErrorMessage(error: unknown) {
  return getErrorMessage(error, {
    fallback: "Could not place the order.",
    matcher: (orderError) => {
      if (isPriceBoundError(orderError)) {
        return LIMIT_PRICE_OUT_OF_BAND_MESSAGE;
      }

      return LIMIT_ORDER_ERROR_COPY.find(({ match }) =>
        match.some((needle) => orderError.message.includes(needle))
      )?.message;
    },
  });
}

/**
 * Derives the limit ticket's primary action, checked in blocking order:
 * in-flight placement, form validity, mock preview, missing order-manager
 * configuration, then the shared wallet gate and the deposit balance. Ends at
 * the place action only when nothing blocks it.
 */
export function getLimitOrderAction({
  environment,
  fieldError,
  insufficientBalance,
  isPlacing,
  onPlace,
  orderManagerConfigured,
  publicClientReady,
  sideLabel,
  spendLabel,
  wallet,
  walletClientReady,
}: {
  environment: VenueTradingEnvironment;
  fieldError: string | null;
  insufficientBalance: boolean;
  isPlacing: boolean;
  onPlace: () => void;
  orderManagerConfigured: boolean;
  publicClientReady: boolean;
  sideLabel: string;
  spendLabel: string;
  wallet: ReturnType<typeof useWalletAccount>;
  walletClientReady: boolean;
}): VenueSwapAction {
  if (isPlacing) {
    return {
      disabled: true,
      label: "Placing order",
      onClick: undefined,
    };
  }

  if (fieldError) {
    return {
      disabled: true,
      label: "Place limit order",
      onClick: undefined,
    };
  }

  if (environment.kind === "mock") {
    // Resting orders escrow real tokens, so the fixture preview does not
    // simulate them — same policy as the market-order ticket.
    return {
      disabled: true,
      label: "Preview only - no venue connected",
      onClick: undefined,
    };
  }

  if (!orderManagerConfigured) {
    return {
      disabled: true,
      label: "Limit orders unavailable",
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
        spendLabel === "pUSD"
          ? "Insufficient pUSD"
          : `Insufficient ${sideLabel} tokens`,
      onClick: undefined,
    };
  }

  return {
    disabled: false,
    label: "Place limit order",
    onClick: onPlace,
  };
}
