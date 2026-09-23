/**
 * Signed formatting for P&L figures. The house `formatUsd` clamps negatives
 * to zero — right for a balance, wrong for a loss — so the sign is applied
 * here around the magnitude, and the caller pairs it with a direction glyph
 * so a gain never reads by colour alone.
 */

import { wadToNumber } from "@/domain/tokens/wad";
import { formatUsd } from "@/lib/format";

/** "+$12.40", "-$3.00", "$0.00" — an explicitly signed WAD money amount. */
export function formatSignedUsdWad(amountWad: bigint): string {
  const magnitude = formatUsd(Math.abs(wadToNumber(amountWad)));

  if (amountWad > 0n) {
    return `+${magnitude}`;
  }

  return amountWad < 0n ? `-${magnitude}` : magnitude;
}

/** "+24.8%", "-12.0%", "0.0%" — a signed return from basis points. */
export function formatSignedPercentBps(bps: number): string {
  const magnitude = (Math.abs(bps) / 100).toFixed(1);

  if (bps > 0) {
    return `+${magnitude}%`;
  }

  return bps < 0 ? `-${magnitude}%` : `${magnitude}%`;
}
