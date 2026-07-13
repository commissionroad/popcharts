# Graduation Clearing Keeper — Design

Status: **Proposed (2026-07-09).** This is the design that ADR 0008's clearing
items require before implementation. It defines the band-pass sweep, the
integer rounding policy (whitepaper open question 3), the keeper's decision
logic across all three outcomes, the reconstruction/verification of the frozen
book, module layout, and the golden-test plan.

Companion docs: `wiki/concepts/graduation-clearing.md` (the mechanism),
`documents/whitepaper_v4.pdf` §5–§11 (the math source of truth),
protocol ADR 0006 (optimistic offchain clearing), protocol ADR 0010 (challenge
window default 0), ADR 0008 (this vertical), ADR 0014 (E2E must boot it),
ADR 0015 (deploys as its own service).

## 1. Purpose

When a market's *matched* demand is large enough, freeze its receipt book,
compute band-pass clearing deterministically, and submit the Merkle clearing
root on-chain — with no manual script. Today `server/src/api/services/`
`dev-graduation-clearing.ts` is an explicit **greedy placeholder** (fills
receipts in placement order; ignores the path intervals entirely) gated to
local dev in `server/src/keeper/`. This replaces the placeholder's *plan
computation* with the real sweep and promotes it to run on any network.

The Merkle/leaf plumbing already matches the contract byte-for-byte
(`hashReceiptClaim`, `buildClaimMerkleTree`, `RECEIPT_CLAIM_TYPEHASH`) and is
reused unchanged. **Only the fill logic is wrong today.**

## 2. Scope and non-goals

In scope: a pure `computeBandPassClearing` function (the golden-tested core),
frozen-book reconstruction + `snapshotHash` verification, the keeper decision
logic (graduate vs refund vs wait), and wiring into the existing keeper loop.

Out of scope (deferred, consistent with ADR 0008 / protocol ADR 0006): bonded
challenges and fraud proofs, a challenger that re-derives and disputes a
submitted root (challenge window defaults to 0 on testnet — the keeper is
trusted, tamper-evident), cross-implementation bit-for-bit determinism beyond
our own canonical rounding, and deployment (ADR 0015).

## 3. On-chain surface (the data contract the plan must satisfy)

Frozen at `startGraduation` (`PregradManager.sol:691`), emitted on
`GraduationStarted(marketId, manager, receiptCount, totalEscrowed, path,
yesShares, noShares, graduationStartedAt, snapshotHash)`. Once `Graduating`,
no receipt/escrow/path state can change, so the book is stable.

`snapshotHash` = `keccak256(abi.encode(GRADUATION_SNAPSHOT_TYPEHASH, chainId,
manager, marketId, receiptCount, totalEscrowed, path, yesShares, noShares,
graduationStartedAt))` (`PregradManager.sol:1306`). It commits to the five
accounting totals, **not** to individual receipts or the root.

`submitClearingRoot(marketId, merkleRoot, matchedMarketCap, retainedCostTotal,
refundTotal, completeSetCount)` validates (`_validateClearingRoot`,
`PregradManager.sol:1060`) exactly:

```
merkleRoot != 0 ; market Graduating ; no prior root
matchedMarketCap  >= graduationThreshold          (raw collateral units)
retainedCostTotal == matchedMarketCap == completeSetCount
retainedCostTotal +  refundTotal == totalEscrowed  (frozen)
```

Per-leaf checks happen later, at claim (`_validateReceiptClaim`,
`PregradManager.sol:1098`): `retainedCost + refund == receipt.cost`,
`retainedShares <= receipt.shares`, and `marketId/owner/side` match the stored
receipt.

**The root is unbound at submit** — the contract never checks that leaf
`retainedCost`/`refund` sum to the submitted totals. That consistency is
*entirely the keeper's responsibility*; a bad plan passes `submitClearingRoot`
and only fails later as an escrow underflow at claim or a postgrad capacity
mismatch at `finalizeGraduation` (`outcomeCapacity == completeSetCount`,
`PregradManager.sol:787`). This is why the golden + property tests below are
load-bearing, not a nicety.

Refund-only branch: `markRefundable(marketId)` (`PregradManager.sol:856`) is
callable only **at/after** `graduationDeadline`; `startGraduation` only
**before** it. The two are deadline-complementary — see §7.

## 4. Receipt model

Each receipt is an interval on the signed path `r = q_yes − q_no`, recorded
directly on-chain (no LMSR reconstruction needed) and already indexed to
`market-events` (`r_low`, `r_high` text columns, `receipt-placed.ts:44`):

- `Receipt{ side, shares, cost, rLow, rHigh, sequence }`, with
  `rHigh − rLow == shares` exactly (side-independent).
- YES occupies `[path, path+shares]` (pushed `r` up); NO occupies
  `[path−shares, path]` (pushed `r` down).
- `cost` is the exact collateral the receipt escrowed (the LMSR path cost,
  already computed on-chain at placement) — the keeper never recomputes it,
  only splits it across bands.

Units note: `shares` (path width) and `cost`/collateral share one numeraire —
the conservation identity `YES_cost + NO_cost = band width` means one share of
fully-covered width equals one collateral unit equals one complete set. The
whitepaper invariant `retained_cost_ℓ ≤ retained_shares_ℓ` (marginal price < 1)
is only meaningful because they are the same scale. The exact fixed-point scale
(collateral is 6-decimal on Arc) is pinned in §9.

## 5. The band-pass sweep (whitepaper v4 §6)

Pure function over the frozen book. Verified against Example A (§10) to 4
decimals.

1. For each active receipt build `[rLow, rHigh]` (already stored).
2. Collect all endpoints, sort, dedupe → boundary set. Every band is therefore
   *fully inside or fully outside* each receipt — no partial coverage.
3. For each adjacent band `[r_k, r_{k+1}]` with width `w_k = r_{k+1} − r_k`
   (skip zero-width; dust threshold = 0 for v1, see §11):
   - `Y_k` = count of YES receipts covering the whole band
     (`rLow ≤ r_k ∧ rHigh ≥ r_{k+1}`); `N_k` = same for NO.
   - If `Y_k == 0 ∨ N_k == 0` → **band fails**, retain nothing.
   - Else `m_k = min(Y_k, N_k)`. Scarce side fully retained (fraction 1);
     crowded side prorated by `m_k / sideCount`.
   - Each covering YES receipt gains
     `Δshares = (m_k/Y_k)·w_k`, `Δcost = (m_k/Y_k)·YES_cost[r_k,r_{k+1}]`;
     symmetric for NO with `N_k` and `NO_cost`.
   - Band market cap `F_k = w_k · m_k`.
4. Per receipt: `refund_ℓ = cost_ℓ − retained_cost_ℓ`.
5. `F = Σ F_k`. Graduate iff `F ≥ graduationThreshold`.

Per-band cost split uses the LMSR closed forms (need `b = liquidityParameter`,
in `MarketConfig`):

```
YES_cost[u,v] = b·ln( (1 + e^(v/b)) / (1 + e^(u/b)) )
NO_cost[u,v]  = b·ln( (1 + e^(−u/b)) / (1 + e^(−v/b)) )   ,  u = r_low < v = r_high
```

with `YES_cost[u,v] + NO_cost[u,v] = v − u = w_k` (this identity is what makes
the totals reconcile).

## 6. Conservation & the contract's triple-equality (why they agree)

Summing a matched band over its covering receipts: YES side retains
`Y_k·(m_k/Y_k)·YES_cost = m_k·YES_cost`; NO side retains `m_k·NO_cost`; band
retained cost `= m_k·(YES_cost+NO_cost) = m_k·w_k = F_k`. Therefore

```
retainedCostTotal = Σ F_k = F = matchedMarketCap
completeSetCount  = F                       (1 complete set per matched unit)
Σ retained YES shares = Σ retained NO shares = F   (complete-set balance)
refundTotal = totalEscrowed − F
```

which is exactly the contract's forced `retainedCostTotal == matchedMarketCap
== completeSetCount` and `retained + refund == totalEscrowed`. The share
balance (`Σ retained YES == Σ retained NO == completeSetCount`) is *not* checked
by the contract but is required for the postgrad adapter to mint balanced
complete sets — the keeper must preserve it exactly (§8).

## 7. Keeper decision logic (the three outcomes)

The keeper polls markets and computes the sweep **offchain, before touching the
chain**, so it never strands a `Graduating` market below threshold:

- **F ≥ threshold, before deadline → graduate.** `startGraduation` →
  reconstruct/verify the frozen book against the emitted `snapshotHash` →
  `computeBandPassClearing` → build root → `submitClearingRoot`. Covers *full
  match* (every band scarce) and *partial match with refunds* (some bands fail
  or are crowded) identically — the difference is purely in the per-receipt
  numbers.
- **Deadline reached, F < threshold → refund.** `markRefundable`. This is the
  *no-match/full-refund* outcome; it never goes through `submitClearingRoot`
  (which would revert `MatchedMarketCapBelowThreshold`).
- **Otherwise → wait.** Not yet eligible; poll again.

Idempotency/safety mirrors the review runner: re-entrancy guarded by on-chain
status (`Graduating`, existing root) and the keeper's own lease/cursor, so a
crash between `startGraduation` and `submitClearingRoot` is recoverable (on
restart the market is `Graduating` with no root → recompute and submit).

## 8. Integer rounding policy (whitepaper open question 3)

The whitepaper leaves rounding **deliberately unspecified**; it only fixes the
invariants rounding must preserve *exactly*. Our canonical v1 policy:

- Work in the on-chain fixed-point scale (§9). The scarce side of a band is
  retained in full (exact). Only the **crowded** side's proration
  `(m_k/sideCount)` needs division.
- Distribute each crowded band's retained **shares** across its covering
  receipts by **largest-remainder (Hamilton) apportionment**, so they sum
  exactly to the scarce side's `m_k·w_k` (preserving the per-band complete-set
  balance in §6). Break remainder ties by receipt `sequence` (`τ`) — the
  whitepaper's stated tie-break hook.
- Allocate retained **cost** the same way against the band's `m_k·YES_cost`
  (resp. `NO_cost`), floor per receipt, then hand the floor remainder to the
  lowest-`τ` receipts until the band cost total is exact.
- Compute `refund_ℓ = cost_ℓ − retained_cost_ℓ` **last**, guaranteeing
  `retained_cost + refund == cost` per receipt with zero drift.
- Assert post-conditions before submit (fail closed): the four contract
  invariants (§3), `Σ leaf.retainedCost == retainedCostTotal`,
  `Σ leaf.refund == refundTotal`, `Σ retained YES shares == Σ retained NO
  shares == completeSetCount`, and per-leaf `retainedCost ≤ retainedShares ≤
  receipt.shares`. Any violation aborts the submit (never ship an
  under-collateralized root).

Rationale: rounding retained cost **down** means the market never overstates
locked collateral (`L ≤ F` can only err toward solvency); the largest-remainder
step restores exact equality so `L = F` holds, not just `L ≤ F`. This is a
documented, deterministic module — the only hard constraints are the §6
identities, held exactly.

## 9. Fixed-point scale (to pin in implementation)

Collateral/cost is 6-decimal on Arc. `r`/shares must share that scale for
`retained_cost ≤ retained_shares` to hold. Implementation step 0 is to confirm
the on-chain scale of `rLow/rHigh` vs `cost` from `LmsrMath` and pin a single
`SCALE` constant used by both the sweep and the golden fixture. `ln`/`exp` for
the per-band cost split run in JS `number`/`bigint` high precision offchain
(we are not bound by on-chain fixed-point `ln`, since the contract does not
recompute cost) and are reconciled to the integer receipt `cost` by
largest-remainder so sub-band costs sum to `cost` exactly.

## 10. Golden test — Example A (whitepaper §9)

`b = 100`, open 20%, threshold 40. Receipts (side, %→%, shares, cost):
Alice YES 20→40 `s=98.083 c=28.7682`; Noah NO 40→30 `s=44.183 c=28.7682`;
Bea YES 30→35 `s=22.826 c=7.4108`.

Bands: `[20,30]` one-sided → fails; `[30,35]` Y=2 (Alice,Bea) N=1 (Noah) →
Noah full, Alice+Bea half; `[35,40]` 1:1 → full.

Expected per-receipt: Alice `retainedShares 32.7704, retainedCost 11.7097,
refund 17.0585`; Bea `11.4130 / 3.7054 / 3.7054`; Noah `44.1833 / 28.7682 / 0`.
Totals: `matchedMarketCap = retainedCostTotal = completeSetCount = 44.1833`,
`refundTotal = 20.7639`, `totalEscrowed = 64.9472`. Conservation
`R + L = 20.7639 + 44.1833 = 64.9472 = E` ✓.

The fixture is encoded at the pinned `SCALE` and asserted exactly (post
rounding). Example B in the whitepaper is qualitative (no per-receipt numbers)
— **not** a fixture; a second fixture is synthesized from the §4 closed forms
to cover a crowded-both-sides band and a fully-failed graduation.

Property tests (fast-check) over random books assert the §8 post-conditions
always hold: conservation exact, share balance exact, `retainedCost ≤
retainedShares`, refunds in `[0, cost]`, and determinism (same book → same
root, and `τ`-permutation independence except tie-break order).

## 11. Build slices

1. **Pure core + fixtures.** `computeBandPassClearing` (sweep + rounding) with
   Example A golden test and property tests. No chain. Reuses
   `hashReceiptClaim`/`buildClaimMerkleTree` (extract them from
   `dev-graduation-clearing.ts` into a shared `clearing/` module; leave the dev
   greedy builder importing the shared plumbing so nothing else breaks).
2. **Reconstruction + verification.** Load the frozen book from indexed
   receipts, recompute `snapshotHash`, assert it equals the `GraduationStarted`
   value before trusting the book.
3. **Keeper wiring.** Replace `buildDevClearingPlan` in the graduation pass with
   the real plan for markets where `F ≥ threshold`; add the `markRefundable`
   branch at deadline; ungate from local-only. Keep the greedy builder behind a
   dev flag for existing local smoke, or migrate those tests.
4. **E2E hook (ADR 0014 handoff).** Expose the keeper in the full-stack boot so
   the lifecycle spec can drive graduation→clearing deterministically.

## 12. Open questions / risks

- **Fixed-point scale of `r` vs collateral** (§9) — must confirm before coding
  the fixture; everything else is scale-relative.
- **Dust bands** — v1 uses threshold 0 (only skip exactly-zero-width). If real
  books produce sub-unit bands that round to zero retained cost, revisit.
- **Below-threshold-after-start** — should be impossible given §7 (we compute
  before `startGraduation`), but add a guard: if a `Graduating` market's
  recomputed `F < threshold`, alarm rather than submit (indicates an indexer/
  freeze race).
- **Cross-keeper determinism** — deferred with the challenge window; our
  canonical rounding is the future reference implementation, so document it as
  normative now.
