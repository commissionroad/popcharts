export function formatAddress(address: string) {
  if (address.length <= 10) {
    return address;
  }

  return `${address.slice(0, 5)}...${address.slice(-3)}`;
}

export function formatB(value: number) {
  return value.toLocaleString("en-US");
}

export function formatCents(value: number) {
  return `${Math.round(value)}c`;
}

export function formatPercent(value: number) {
  return `${Math.round(value)}%`;
}

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

export function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
    minimumFractionDigits: value >= 100 ? 0 : 2,
    style: "currency",
  }).format(Math.max(0, value));
}

export function formatUsdWhole(value: number) {
  return `$${Math.max(0, Math.round(value)).toLocaleString("en-US")}`;
}
