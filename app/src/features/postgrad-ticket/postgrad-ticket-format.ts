import type { VenueSwapStep } from "./postgrad-swap-service";

/**
 * Progress copy for each on-chain venue swap step, shown while a transaction
 * sequence is in flight.
 */
export function formatSwapStep(step: VenueSwapStep | "minting") {
  const labels: Record<VenueSwapStep | "minting", string> = {
    approving: "Approving router spend...",
    confirming: "Waiting for confirmation...",
    minting: "Minting local test pUSD...",
    swapping: "Submitting swap...",
  };

  return labels[step];
}

/**
 * Renders one balance line for the ticket, preferring the blocking state over
 * the number: connect prompt, loading, unavailable on read errors, then the
 * unit-suffixed balance with decimals only under 100.
 */
export function formatVenueBalance({
  balance,
  error,
  isLoading,
  unit,
  walletConnected,
}: {
  balance: number | null;
  error: string | null;
  isLoading: boolean;
  unit: string;
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

  if (balance === null) {
    return "--";
  }

  return `${balance.toLocaleString("en-US", {
    maximumFractionDigits: balance >= 100 ? 0 : 2,
    minimumFractionDigits: balance > 0 && balance < 100 ? 2 : 0,
  })} ${unit}`;
}

/**
 * Formats a venue price in cents with one decimal ("61.8c") — venue fills
 * settle at exact pool prices, so whole-cent rounding would hide real price
 * movement between the pool price and the effective fill price.
 */
export function formatVenuePriceCents(value: number) {
  return `${value.toFixed(1)}c`;
}

/**
 * Formats an outcome-token amount: whole tokens from 1,000 up, two decimals
 * below that.
 */
export function formatVenueTokens(value: number) {
  if (value >= 1_000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }

  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
