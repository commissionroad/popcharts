import type { ReceiptQuotePreview } from "@/domain/pregrad-trading/receipt-quote";
import { formatPercent } from "@/lib/format";

import type { ReceiptPlacementStep } from "./place-receipt-service";

/**
 * Renders the pUSD balance line for the ticket, preferring the blocking state
 * over the number: connect prompt, loading, unavailable on read errors, then
 * the balance with cents only under 100 pUSD.
 */
export function formatPusdBalance({
  balanceUsd,
  error,
  isLoading,
  walletConnected,
}: {
  balanceUsd: number | null;
  error: string | null;
  isLoading: boolean;
  walletConnected: boolean;
}) {
  if (!walletConnected) {
    return "Connect wallet";
  }

  if (isLoading) {
    return "Loading...";
  }

  if (error) {
    return "Unavailable";
  }

  if (balanceUsd === null) {
    return "--";
  }

  return `${balanceUsd.toLocaleString("en-US", {
    maximumFractionDigits: balanceUsd >= 100 ? 0 : 2,
    minimumFractionDigits: balanceUsd > 0 && balanceUsd < 100 ? 2 : 0,
  })} pUSD`;
}

/**
 * Progress copy for each on-chain receipt placement step, shown while a
 * transaction sequence is in flight.
 */
export function formatPlacementStep(step: ReceiptPlacementStep) {
  const labels: Record<ReceiptPlacementStep, string> = {
    approving: "Approving pUSD spend...",
    confirming: "Waiting for confirmation...",
    minting: "Minting local test pUSD...",
    placing: "Submitting receipt...",
    quoting: "Refreshing chain quote...",
  };

  return labels[step];
}

/**
 * Renders a quote's price band as the "from to to" probability range the
 * priced intent walks while it fills.
 */
export function formatPriceBand(quote: ReceiptQuotePreview) {
  return `${formatPercent(quote.priceBand.fromProbability)} to ${formatPercent(
    quote.priceBand.toProbability
  )}`;
}

/**
 * Formats a receipt share count: whole shares from 1,000 up, two decimals
 * below that.
 */
export function formatShares(value: number) {
  if (value >= 1_000) {
    return value.toLocaleString("en-US", {
      maximumFractionDigits: 0,
    });
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
}

/**
 * Formats a derived budget for the amount input: whole dollars from 100 up,
 * otherwise up to two decimals with trailing zeros trimmed.
 */
export function formatPresetAmount(value: number) {
  if (value >= 100) {
    return Math.floor(value).toString();
  }

  return value.toFixed(2).replace(/\.?0+$/, "");
}
