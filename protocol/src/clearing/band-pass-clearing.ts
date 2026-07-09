import {
  buildClaimMerkleTree,
  hashReceiptClaim,
  type ClearingPlan,
  type ReceiptClaim,
} from "./receipt-claim-merkle.js";

/**
 * Band-pass graduation clearing (whitepaper v4 §6).
 *
 * Replaces the greedy placement-order stand-in in `dev-graduation-clearing.ts`
 * with the real mechanism: sweep the frozen receipt book by price band, match a
 * band only where BOTH a YES and a NO receipt cover it, retain the scarce side
 * fully and prorate the crowded side, then refund every unmatched share.
 *
 * All quantities are WAD (1e18) — the units the PregradManager stores for
 * `cost`, `shares`, `path`, `rLow`, and `rHigh` — so the plan the keeper submits
 * matches the on-chain integers exactly (decimal scaling lives at the postgrad
 * boundary, not here).
 *
 * Invariant provenance: matched market cap, complete-set count, and both retained
 * share totals are all `Σ_bands min(Y_k,N_k)·width_k`, computed in exact integer
 * arithmetic — no float touches them. Floating point is used only to weight how a
 * band's fixed retained cost is split across its claimants (the economics), and
 * the split is reconciled back to the exact integer total. The contract leaves
 * the Merkle root unbound at `submitClearingRoot`, so every invariant is asserted
 * here before returning; a violation throws rather than shipping a bad root.
 */

export const SIDE_YES = 0;
export const SIDE_NO = 1;

/** A frozen pre-graduation receipt, reconstructed from ReceiptPlaced logs. */
export type ClearingReceipt = {
  cost: bigint;
  marketId: bigint;
  owner: `0x${string}`;
  receiptId: bigint;
  rHigh: bigint;
  rLow: bigint;
  sequence: bigint;
  shares: bigint;
  side: number;
};

export type BandPassClearingResult = ClearingPlan & {
  /** Whether matched market cap reached the graduation threshold. */
  graduates: boolean;
};

type WorkingClaim = {
  costWeight: bigint;
  index: number;
  receipt: ClearingReceipt;
  retainedCost: bigint;
  retainedShares: bigint;
};

/**
 * Computes the band-pass clearing plan for a frozen receipt book. Returns the
 * per-receipt claims, the conserved totals, and whether the market graduates.
 * Throws on inconsistent input (empty book, width != shares) or a failed
 * post-condition — it never returns a plan the contract would reject.
 */
export function computeBandPassClearing({
  graduationThreshold,
  liquidityParameter,
  receipts,
}: {
  graduationThreshold: bigint;
  liquidityParameter: bigint;
  receipts: ClearingReceipt[];
}): BandPassClearingResult {
  if (receipts.length === 0) {
    throw new Error("Cannot clear a market without receipts.");
  }

  const working: WorkingClaim[] = receipts.map((receipt, index) => {
    if (receipt.rHigh - receipt.rLow !== receipt.shares) {
      throw new Error(
        `Receipt ${receipt.receiptId} width (${receipt.rHigh - receipt.rLow}) ` +
          `!= shares (${receipt.shares}).`,
      );
    }
    return {
      costWeight: 0n,
      index,
      receipt,
      retainedCost: 0n,
      retainedShares: 0n,
    };
  });

  const totalEscrowed = receipts.reduce((sum, r) => sum + r.cost, 0n);

  // Boundary set: every distinct interval endpoint. Because it contains every
  // endpoint, each band lies fully inside or fully outside each receipt — there
  // is no partial-coverage case to reason about.
  const boundaries = [...new Set(receipts.flatMap((r) => [r.rLow, r.rHigh]))].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  let matchedMarketCap = 0n;

  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const low = boundaries[i]!;
    const high = boundaries[i + 1]!;
    const width = high - low;
    if (width <= 0n) continue;

    const yes = working.filter((w) => covers(w, SIDE_YES, low, high));
    const no = working.filter((w) => covers(w, SIDE_NO, low, high));
    // A band matches only with opposing demand on both sides.
    if (yes.length === 0 || no.length === 0) continue;

    const matched = BigInt(Math.min(yes.length, no.length));
    const bandRetainedPerSide = matched * width;
    matchedMarketCap += bandRetainedPerSide;

    // Receipt-independent LMSR cost of moving YES across the band; NO is the
    // exact complement so YES_cost + NO_cost = width with zero drift.
    const yesCost = yesBandCost(low, high, liquidityParameter);
    const noCost = width - yesCost;

    distributeBand(yes, width, yesCost, bandRetainedPerSide, matched);
    distributeBand(no, width, noCost, bandRetainedPerSide, matched);
  }

  const completeSetCount = matchedMarketCap;
  const refundTotal = totalEscrowed - matchedMarketCap;

  // Retained cost is forced equal to matchedMarketCap (the contract's
  // triple-equality). Apportion it by each receipt's economic weight, capped at
  // min(cost, retainedShares), so refunds never go negative and locked
  // collateral never exceeds the shares backing it.
  const retainedCosts = apportion(
    matchedMarketCap,
    working.map((w) => w.costWeight),
    working.map((w) => minBig(w.receipt.cost, w.retainedShares)),
    working.map((w) => w.receipt.sequence),
  );
  working.forEach((w, i) => {
    w.retainedCost = retainedCosts[i]!;
  });

  const claims: ReceiptClaim[] = working.map((w) => ({
    marketId: w.receipt.marketId,
    owner: w.receipt.owner,
    receiptId: w.receipt.receiptId,
    refund: w.receipt.cost - w.retainedCost,
    retainedCost: w.retainedCost,
    retainedShares: w.retainedShares,
    side: w.receipt.side,
  }));

  assertInvariants({
    claims,
    completeSetCount,
    matchedMarketCap,
    refundTotal,
    totalEscrowed,
    working,
  });

  const { proofs, root } = buildClaimMerkleTree(claims.map(hashReceiptClaim));

  return {
    claims,
    completeSetCount,
    graduates: matchedMarketCap >= graduationThreshold,
    matchedMarketCap,
    merkleRoot: root,
    proofs,
    refundTotal,
    retainedCostTotal: matchedMarketCap,
    totalEscrowed,
  };
}

function covers(w: WorkingClaim, side: number, low: bigint, high: bigint): boolean {
  return w.receipt.side === side && w.receipt.rLow <= low && w.receipt.rHigh >= high;
}

/**
 * Credits one matched band to its covering receipts on a single side. The scarce
 * side (count == matched) retains the whole band; a crowded side splits the
 * matched total by even bigint apportionment with remainders broken by sequence.
 * Retained shares are recorded exactly; a bigint economic cost weight is
 * accumulated for the later global cost apportionment.
 */
function distributeBand(
  side: WorkingClaim[],
  width: bigint,
  bandCost: bigint,
  bandRetainedShares: bigint,
  matched: bigint,
): void {
  if (BigInt(side.length) === matched) {
    // Scarce side: every receipt keeps the full band.
    for (const w of side) {
      w.retainedShares += width;
      w.costWeight += bandCost;
    }
    return;
  }

  // Crowded side: share `bandRetainedShares` across the receipts, each capped at
  // the full band width, remainder to the lowest sequences.
  const shares = apportion(
    bandRetainedShares,
    side.map(() => 1n),
    side.map(() => width),
    side.map((w) => w.receipt.sequence),
  );
  // Cost weight tracks each receipt's prorated slice of the band cost: the band
  // retains `matched` full-band costs, shared across the crowded claimants.
  const weights = apportion(
    matched * bandCost,
    side.map(() => 1n),
    side.map(() => bandCost),
    side.map((w) => w.receipt.sequence),
  );
  side.forEach((w, i) => {
    w.retainedShares += shares[i]!;
    w.costWeight += weights[i]!;
  });
}

/**
 * Apportions an exact integer `total` across buckets proportional to integer
 * `weights`, never exceeding `caps`, summing to exactly `total`. Whole units go
 * by proportional floor; the remainder is filled by largest fractional part,
 * ties broken by ascending `tiebreak` (receipt sequence), then greedily by
 * headroom. Requires sum(caps) >= total. Pure bigint.
 */
export function apportion(
  total: bigint,
  weights: bigint[],
  caps: bigint[],
  tiebreak: bigint[],
): bigint[] {
  const n = weights.length;
  const result = new Array<bigint>(n).fill(0n);
  if (total === 0n || n === 0) return result;

  const capSum = caps.reduce((s, c) => s + c, 0n);
  if (capSum < total) {
    throw new Error(`apportion: caps ${capSum} cannot cover total ${total}.`);
  }

  const weightSum = weights.reduce((s, w) => s + w, 0n);
  const useEven = weightSum === 0n;
  const effWeights = useEven ? weights.map(() => 1n) : weights;
  const effSum = useEven ? BigInt(n) : weightSum;

  // Proportional floor, capped. Track the fractional remainder numerator so the
  // leftover can be handed out largest-remainder-first, deterministically.
  const fracNum = new Array<bigint>(n).fill(0n);
  let assigned = 0n;
  for (let i = 0; i < n; i += 1) {
    const scaled = total * effWeights[i]!;
    const floor = scaled / effSum;
    const capped = floor < caps[i]! ? floor : caps[i]!;
    result[i] = capped;
    fracNum[i] = floor < caps[i]! ? scaled % effSum : 0n;
    assigned += capped;
  }

  let remainder = total - assigned;
  if (remainder === 0n) return result;

  const ranked = Array.from({ length: n }, (_, i) => i)
    .filter((i) => result[i]! < caps[i]!)
    .sort((a, b) => {
      if (fracNum[a] !== fracNum[b]) return fracNum[a]! > fracNum[b]! ? -1 : 1;
      return tiebreak[a]! < tiebreak[b]! ? -1 : 1;
    });

  for (const i of ranked) {
    if (remainder === 0n) break;
    const headroom = caps[i]! - result[i]!;
    const give = headroom < remainder ? headroom : remainder;
    result[i] = result[i]! + give;
    remainder -= give;
  }
  if (remainder !== 0n) {
    throw new Error("apportion: unable to place remainder within caps.");
  }
  return result;
}

/**
 * LMSR path cost C(r) = b·softplus(r/b), in WAD. Rounded once per coordinate so
 * that band costs are *additive*: because C(r) is a deterministic bigint,
 * yesBandCost(a,c) == yesBandCost(a,b) + yesBandCost(b,c) exactly — a shared
 * split point cancels, so a fully-retained receipt refunds exactly zero. The
 * absolute value carries sub-economic float imprecision, which is fine: C never
 * feeds an invariant, only the weighting of how a band's fixed cost is split.
 */
export function lmsrCost(path: bigint, liquidityParameter: bigint): bigint {
  const bWad = Number(liquidityParameter);
  return BigInt(Math.round(bWad * softplus(Number(path) / bWad)));
}

/** LMSR cost of moving YES across [low, high]: C(high) − C(low), in WAD. */
export function yesBandCost(low: bigint, high: bigint, liquidityParameter: bigint): bigint {
  return lmsrCost(high, liquidityParameter) - lmsrCost(low, liquidityParameter);
}

/** Numerically stable softplus: ln(1 + e^x) = max(x,0) + ln(1 + e^-|x|). */
function softplus(x: number): number {
  return Math.max(x, 0) + Math.log1p(Math.exp(-Math.abs(x)));
}

function assertInvariants({
  claims,
  completeSetCount,
  matchedMarketCap,
  refundTotal,
  totalEscrowed,
  working,
}: {
  claims: ReceiptClaim[];
  completeSetCount: bigint;
  matchedMarketCap: bigint;
  refundTotal: bigint;
  totalEscrowed: bigint;
  working: WorkingClaim[];
}): void {
  const fail = (msg: string): never => {
    throw new Error(`band-pass clearing invariant violated: ${msg}`);
  };

  const retainedCostTotal = claims.reduce((s, c) => s + c.retainedCost, 0n);
  const refundSum = claims.reduce((s, c) => s + c.refund, 0n);
  let yesShares = 0n;
  let noShares = 0n;

  for (const claim of claims) {
    if (claim.refund < 0n) fail(`negative refund on receipt ${claim.receiptId}`);
    if (claim.retainedCost < 0n) fail(`negative retained cost on receipt ${claim.receiptId}`);
    if (claim.retainedCost > claim.retainedShares)
      fail(`retainedCost > retainedShares on receipt ${claim.receiptId}`);
    if (claim.side === SIDE_YES) yesShares += claim.retainedShares;
    else noShares += claim.retainedShares;
  }
  for (const w of working) {
    const claim = claims[w.index]!;
    if (claim.retainedCost + claim.refund !== w.receipt.cost)
      fail(`cost != retained + refund on receipt ${claim.receiptId}`);
    if (claim.retainedShares > w.receipt.shares)
      fail(`retainedShares > shares on receipt ${claim.receiptId}`);
  }

  if (retainedCostTotal !== matchedMarketCap)
    fail(`retainedCostTotal ${retainedCostTotal} != matchedMarketCap ${matchedMarketCap}`);
  if (completeSetCount !== matchedMarketCap) fail("completeSetCount != matchedMarketCap");
  if (retainedCostTotal + refundTotal !== totalEscrowed) fail("retained + refund != totalEscrowed");
  if (refundSum !== refundTotal) fail("leaf refunds != refundTotal");
  if (yesShares !== noShares)
    fail(`retained YES ${yesShares} != retained NO ${noShares} (complete-set imbalance)`);
  if (yesShares !== completeSetCount) fail("retained shares per side != completeSetCount");
}

function minBig(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
