/**
 * Shortens an address or transaction hash to a "0x123...abc" form for
 * display. Values of 10 characters or fewer pass through unchanged.
 */
export function formatAddress(address: string) {
  if (address.length <= 10) {
    return address;
  }

  return `${address.slice(0, 5)}...${address.slice(-3)}`;
}

/**
 * Formats an ISO timestamp as a medium date with a short time, pinned to UTC
 * ("Aug 1, 2026, 12:00 AM UTC") so server and client renders match.
 * Unparseable values pass through unchanged.
 */
export function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const formatted = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(date);

  return `${formatted} UTC`;
}

/**
 * Formats an LMSR liquidity parameter b with thousands separators and no
 * currency symbol — b is a curve parameter, not a dollar amount.
 */
export function formatB(value: number) {
  return value.toLocaleString("en-US");
}

/**
 * Formats a price in cents as a whole-cent label ("64c"), the display unit
 * for outcome prices.
 */
export function formatCents(value: number) {
  return `${Math.round(value)}c`;
}

/**
 * Formats a probability value as a whole percentage ("64%").
 */
export function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

/**
 * Formats a USD amount compactly with a K/M/B suffix ("$1.2M") for dense
 * layouts like market cards. Negative inputs clamp to $0.
 */
export function formatUsdCompact(value: number) {
  const amount = Math.max(0, value);
  const units = [
    { suffix: "B", value: 1_000_000_000 },
    { suffix: "M", value: 1_000_000 },
    { suffix: "K", value: 1_000 },
  ] as const;
  const unit = units.find((entry) => amount >= entry.value);

  if (!unit) {
    return `$${Math.round(amount).toLocaleString("en-US")}`;
  }

  const compact = amount / unit.value;
  const digits = compact >= 10 ? 0 : 1;
  const formatted = compact.toFixed(digits).replace(/\.0$/, "");

  return `$${formatted}${unit.suffix}`;
}

/**
 * Formats a USD amount as currency, showing cents only below $100 where they
 * matter. Negative inputs clamp to $0.
 */
export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
    minimumFractionDigits: value >= 100 ? 0 : 2,
    style: "currency",
  }).format(Math.max(0, value));
}

/**
 * Formats a USD amount as whole dollars with separators ("$12,500"), used for
 * round protocol figures like graduation targets. Negative inputs clamp to $0.
 */
export function formatUsdWhole(value: number) {
  return `$${Math.max(0, Math.round(value)).toLocaleString("en-US")}`;
}
