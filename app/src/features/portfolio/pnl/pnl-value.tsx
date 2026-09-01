import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import { type PnlDirection, pnlDirection } from "@/domain/portfolio/pnl";

import { formatSignedPercentBps, formatSignedUsdWad } from "./format-pnl";

/**
 * Colour carries the direction, but never alone: every value also gets an
 * arrow glyph, an explicit +/- in the number, and a screen-reader word. A
 * reader with no colour vision, a greyscale print, and a screen reader all
 * get the same three states.
 */
const DIRECTION_TONE: Record<PnlDirection, string> = {
  down: "var(--negative)",
  flat: "var(--text-secondary)",
  up: "var(--positive)",
};

const DIRECTION_GLYPH: Record<PnlDirection, typeof ArrowUp> = {
  down: ArrowDown,
  flat: Minus,
  up: ArrowUp,
};

const DIRECTION_WORD: Record<PnlDirection, string> = {
  down: "Loss",
  flat: "Break-even",
  up: "Gain",
};

/**
 * A signed P&L amount with its direction cue, and optionally the return it
 * represents. `null` renders the same "no price yet" dash the portfolio
 * already uses for an unpriced position, rather than a misleading $0.00.
 */
export function PnlValue({
  amountWad,
  returnBps = null,
  size = "sm",
}: {
  amountWad: bigint | null;
  returnBps?: number | null;
  size?: "lg" | "sm";
}) {
  if (amountWad === null) {
    return (
      <span className="tabular font-mono text-[var(--text-muted)]">
        -<span className="sr-only">No price available</span>
      </span>
    );
  }

  const direction = pnlDirection(amountWad);
  const Glyph = DIRECTION_GLYPH[direction];
  const large = size === "lg";

  return (
    <span
      className={
        large
          ? "font-display tabular flex items-center gap-1.5 text-2xl font-black"
          : "tabular flex items-center gap-1 font-mono text-sm font-bold"
      }
      style={{ color: DIRECTION_TONE[direction] }}
    >
      <Glyph aria-hidden size={large ? 18 : 13} strokeWidth={3} />
      <span className="sr-only">{DIRECTION_WORD[direction]} of </span>
      {formatSignedUsdWad(amountWad)}
      {returnBps === null ? null : (
        <span
          className={
            large
              ? "tabular font-mono text-sm font-bold opacity-80"
              : "tabular text-xs font-normal opacity-80"
          }
        >
          {formatSignedPercentBps(returnBps)}
        </span>
      )}
    </span>
  );
}
