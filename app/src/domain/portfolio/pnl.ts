/**
 * Profit and loss on a graduated position, in WAD fixed point.
 *
 * The split this module encodes is the one ADR 0013 still owes the portfolio:
 * **realised** P&L is money that has already come back — tokens sold on the
 * venue, winnings redeemed after resolution — and **unrealised** P&L is the
 * paper gain on tokens still held, marked at the venue's current price (or at
 * the settlement price of 1 / 0 / ½ once a market resolves; see
 * `docs/portfolio-data-design.md`, tier 2).
 *
 * Every figure stays a WAD-scaled bigint end to end. Money is never floated:
 * the only `number` leaving here is a basis-point return, computed by integer
 * division, for a percentage label.
 *
 * The inputs are *given*, not derived. Cost basis needs per-swap capture plus
 * lot accounting, which lives server-side (`docs/portfolio-data-design.md`,
 * rollout phase 6) — this module is the presentation-side arithmetic over
 * whatever that read model returns.
 */

import { WAD } from "@/domain/tokens/wad";

/** One basis point is 1/10,000, the integer unit returns are computed in. */
const BPS = 10_000n;

/**
 * The per-position numbers P&L is computed from. All amounts are WAD-scaled
 * and non-negative; only the results below carry a sign.
 */
export type PositionPnlInput = {
  /** Collateral spent acquiring the tokens still owned. */
  costBasisWad: bigint;
  /**
   * Price per token the open lot is marked at: the venue's current price, or
   * the settlement price once resolved. `null` while the pool is
   * uninitialized or a venue read failed — the open lot then has no
   * unrealised figure at all, exactly as `currentValueWad` is omitted today.
   */
  markPriceWad: bigint | null;
  /** Outcome tokens still owned (held plus committed in the owner's asks). */
  ownedTotalWad: bigint;
  /** Cost basis of the portion already disposed of. */
  realisedCostWad: bigint;
  /** Collateral received for that disposed portion: sales plus redemptions. */
  realisedProceedsWad: bigint;
};

/** The derived figures a P&L surface renders. */
export type PositionPnl = {
  /** Cost basis per token still owned; `null` when nothing is owned. */
  avgEntryPriceWad: bigint | null;
  /** Cost basis of the open lot, echoed for the summary rollup. */
  costBasisWad: bigint;
  /** Open lot marked to `markPriceWad`; `null` when unpriced. */
  marketValueWad: bigint | null;
  /** Proceeds minus cost on the portion already closed. */
  realisedWad: bigint;
  /**
   * Total P&L as a return on all capital deployed (open plus closed cost
   * basis), in basis points. `null` when nothing was deployed, or when an
   * unpriced open lot makes the total unknowable.
   */
  returnBps: number | null;
  /** Realised plus unrealised; `null` when the open lot is unpriced. */
  totalWad: bigint | null;
  /** Market value minus cost basis on the open lot; `null` when unpriced. */
  unrealisedWad: bigint | null;
  /**
   * Unrealised gain as a return on the open lot's cost basis, in basis
   * points. `null` when the lot is unpriced or cost nothing.
   */
  unrealisedReturnBps: number | null;
};

/** Which way a signed P&L figure points, for a non-colour cue. */
export type PnlDirection = "down" | "flat" | "up";

/** Classifies a signed WAD amount so callers can pair colour with a glyph. */
export function pnlDirection(amountWad: bigint): PnlDirection {
  if (amountWad > 0n) {
    return "up";
  }

  return amountWad < 0n ? "down" : "flat";
}

/** Computes one position's realised, unrealised, and total P&L. */
export function positionPnl(input: PositionPnlInput): PositionPnl {
  const realisedWad = input.realisedProceedsWad - input.realisedCostWad;
  // A fully closed position needs no quote: it owns nothing, so its open lot
  // is worth nothing whether or not the venue could be read.
  const marketValueWad =
    input.ownedTotalWad === 0n
      ? 0n
      : input.markPriceWad === null
        ? null
        : (input.ownedTotalWad * input.markPriceWad) / WAD;
  const unrealisedWad =
    marketValueWad === null ? null : marketValueWad - input.costBasisWad;
  const totalWad = unrealisedWad === null ? null : realisedWad + unrealisedWad;

  return {
    avgEntryPriceWad:
      input.ownedTotalWad > 0n
        ? (input.costBasisWad * WAD) / input.ownedTotalWad
        : null,
    costBasisWad: input.costBasisWad,
    marketValueWad,
    realisedWad,
    returnBps: returnBps(totalWad, input.costBasisWad + input.realisedCostWad),
    totalWad,
    unrealisedReturnBps: returnBps(unrealisedWad, input.costBasisWad),
    unrealisedWad,
  };
}

/** The summary figures across every position in a portfolio. */
export type PortfolioPnl = {
  /** Open cost basis summed across positions. */
  costBasisWad: bigint;
  /** Market value of the priced open lots. */
  marketValueWad: bigint;
  /** How many positions had no mark price, so their lot is excluded above. */
  unpricedCount: number;
  realisedWad: bigint;
  returnBps: number | null;
  totalWad: bigint;
  unrealisedWad: bigint;
};

/**
 * Rolls positions up into one summary. An unpriced position still contributes
 * its realised P&L and its cost basis — dropping either would understate what
 * the wallet has spent and made — but contributes no market value and no
 * unrealised gain. Its capital therefore sits in the return denominator with
 * no paper gain above it, which pulls `returnBps` down; `unpricedCount` is how
 * the UI knows to label the rollup partial rather than final.
 */
export function portfolioPnl(inputs: PositionPnlInput[]): PortfolioPnl {
  let costBasisWad = 0n;
  let deployedWad = 0n;
  let marketValueWad = 0n;
  let realisedWad = 0n;
  let unpricedCount = 0;
  let unrealisedWad = 0n;

  for (const input of inputs) {
    const pnl = positionPnl(input);

    costBasisWad += pnl.costBasisWad;
    deployedWad += input.costBasisWad + input.realisedCostWad;
    realisedWad += pnl.realisedWad;

    if (pnl.marketValueWad === null || pnl.unrealisedWad === null) {
      unpricedCount += 1;
      continue;
    }

    marketValueWad += pnl.marketValueWad;
    unrealisedWad += pnl.unrealisedWad;
  }

  const totalWad = realisedWad + unrealisedWad;

  return {
    costBasisWad,
    marketValueWad,
    realisedWad,
    returnBps: returnBps(totalWad, deployedWad),
    totalWad,
    unpricedCount,
    unrealisedWad,
  };
}

/**
 * A signed return in basis points, by integer division so no float ever
 * touches money. `null` when there is no capital to return on, or when an
 * unpriced lot leaves the numerator unknown.
 */
function returnBps(totalWad: bigint | null, deployedWad: bigint): number | null {
  if (totalWad === null || deployedWad <= 0n) {
    return null;
  }

  return Number((totalWad * BPS) / deployedWad);
}
