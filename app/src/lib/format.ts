const usdCompact = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 1,
  notation: "compact",
  style: "currency",
});

const usdWhole = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 0,
  style: "currency",
});

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
  return usdCompact.format(value);
}

export function formatUsdWhole(value: number) {
  return usdWhole.format(value);
}
