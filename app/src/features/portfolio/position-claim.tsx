"use client";

import type { PortfolioPosition } from "@popcharts/api-client/models";

import { wadToNumber } from "@/domain/tokens/wad";
import { useRedemption } from "@/integrations/contracts/hooks/use-redemption";
import { MIN_REDEEMABLE_OUTCOME_WAD } from "@/integrations/contracts/redemption-service";
import { formatUsd } from "@/lib/format";

/**
 * The portfolio-table affordance for redeemable settlements: a Claim button
 * on a settled position that signs the postgrad redemption write right here,
 * so claiming does not require a detour to the market page (which offers the
 * same claim). A resolved market's winning side redeems 1:1; either side of
 * a cancelled draw redeems at half value, one row at a time. Renders nothing
 * while the position is not claimable: no terminal event indexed yet, losing
 * side, or nothing held in the wallet (tokens resting in ask orders must be
 * cancelled on the market page first). On a confirmed claim it refreshes the
 * portfolio so the row drops once the indexer projects the burn; the button
 * stays out of action in the meantime so the still-visible row can't be
 * double-claimed.
 */
export function PositionClaim({
  onClaimed,
  position,
}: {
  onClaimed: () => void;
  position: PortfolioPosition;
}) {
  const { error, redeem, redeemDraw, result, status } = useRedemption({
    onRedeemed: onClaimed,
  });

  const resolution = position.resolution;
  const isDraw = resolution?.kind === "cancelled";
  const held = BigInt(position.heldBalance);
  // What this row's claim pays out: 1:1 for a resolved winner, half for a
  // cancelled draw.
  const claimValueWad = isDraw ? held / 2n : held;
  // The one-cent floor keeps sub-display-precision dust from rendering a
  // "Claim $0.00" button that could only revert on low-precision collateral.
  const claimable =
    (isDraw ||
      (resolution?.kind === "resolved" && resolution.winningSide === position.side)) &&
    claimValueWad >= MIN_REDEEMABLE_OUTCOME_WAD;

  if (!claimable && status === "idle") {
    return null;
  }

  const pending = status === "pending";
  const claimed = status === "success";
  const submitClaim = () => {
    if (!resolution) {
      return;
    }

    const marketAddress = resolution.postgradMarket as `0x${string}`;

    if (isDraw) {
      redeemDraw({
        marketAddress,
        noAmount: position.side === "no" ? held : 0n,
        yesAmount: position.side === "yes" ? held : 0n,
      });
    } else {
      redeem({ amount: held, marketAddress, side: position.side });
    }
  };

  return (
    <span className="flex flex-col gap-1">
      <button
        className="inline-flex w-fit items-center rounded-[var(--radius-sm)] border border-[var(--status-graduated)] bg-[var(--surface-raised)] px-2.5 py-1 font-mono text-[11px] font-bold text-[var(--status-graduated)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={pending || claimed}
        onClick={submitClaim}
        type="button"
      >
        {/* Claimed value comes from the service's valueWad (derived from the
            18-decimal burn legs) — the event's collateralAmount is raw
            collateral units whose precision varies by chain (6-dec on Arc). */}
        {pending
          ? "Claiming…"
          : claimed
            ? `Claimed ${result ? formatUsd(wadToNumber(result.valueWad)) : ""}`
            : `Claim ${formatUsd(wadToNumber(claimValueWad))}`}
      </button>
      {error ? <span className="text-[11px] text-[var(--danger)]">{error}</span> : null}
    </span>
  );
}
