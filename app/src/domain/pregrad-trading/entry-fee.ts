import { WAD } from "@/domain/tokens/wad";

/**
 * Entry-fee arithmetic mirroring PregradManager (protocol ADR 0014 §3,
 * docs/fee-model.md). The fee is charged on a receipt's cost at placement and
 * `maxCost` bounds the buyer's TOTAL debit — cost plus fee — so approval
 * sizing and the placement bound must both use these, not the bare cost.
 */

/**
 * The fee due on a cost at a WAD-scaled rate: `floor(cost · rate / 1e18)`,
 * the contract's own floor division, so the app's bound never undershoots
 * what `placeReceipt` will charge.
 */
export function entryFeeForCost(cost: bigint, entryFeeRateWad: bigint): bigint {
  return (cost * entryFeeRateWad) / WAD;
}

/**
 * The total collateral a placement may debit: cost plus its entry fee. The
 * fee is monotone in cost, so bounding the slippage-padded cost with this
 * covers every execution the padding admits.
 */
export function totalDebitForCost(cost: bigint, entryFeeRateWad: bigint): bigint {
  return cost + entryFeeForCost(cost, entryFeeRateWad);
}

/**
 * The rate as a display fraction (1e16 → 0.01). Float precision is fine
 * here: this feeds preview copy, never a transaction bound.
 */
export function entryFeeRateFraction(entryFeeRateWad: bigint): number {
  return Number(entryFeeRateWad) / 1e18;
}
