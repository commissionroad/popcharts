---
type: summary
title: Graduation Clearing Keeper Design (docs/clearing-keeper-design.md)
description: The design ADR 0008's clearing items required — a pure band-pass sweep over the frozen receipt book, a largest-remainder integer rounding policy (whitepaper open question 3), three-outcome keeper decision logic, snapshotHash verification, and a golden-test plan; replaces the greedy dev placeholder.
sources:
  - docs/clearing-keeper-design.md
updated: 2026-07-13
---

# Graduation Clearing Keeper Design

**Status: Proposed (2026-07-09).** The design ADR 0008's clearing items require
before implementation. It turns [graduation clearing](../concepts/graduation-clearing.md)
into an automated service: when a market's *matched* demand is large enough,
freeze its receipt book, compute band-pass clearing deterministically, and
submit the Merkle clearing root on-chain — no manual script.

Today `server/src/api/services/dev-graduation-clearing.ts` is an explicit
**greedy placeholder** (fills receipts in placement order, ignores the path
intervals) gated to local dev. This replaces the placeholder's *plan
computation* with the real sweep and promotes it to any network. The
Merkle/leaf plumbing already matches the contract byte-for-byte
(`hashReceiptClaim`, `buildClaimMerkleTree`, `RECEIPT_CLAIM_TYPEHASH`) and is
reused unchanged — **only the fill logic is wrong today.**

## Why the golden tests are load-bearing

`submitClearingRoot` validates only four aggregate identities
(`matchedMarketCap ≥ threshold`; `retainedCostTotal == matchedMarketCap ==
completeSetCount`; `retained + refund == totalEscrowed`; `Graduating`, no prior
root). **The root is unbound at submit** — the contract never checks that leaf
`retainedCost`/`refund` sum to the submitted totals, nor that YES/NO retained
shares balance. That consistency is *entirely the keeper's responsibility*; a
bad plan passes submit and only fails later as an escrow underflow at claim or a
postgrad capacity mismatch at `finalizeGraduation`. Hence golden + property
tests are load-bearing, not a nicety.

## The band-pass sweep (whitepaper v4 §6)

A pure function over the frozen book: build each receipt interval `[rLow,rHigh]`
on the signed path `r = q_yes − q_no` (already indexed, `rHigh − rLow == shares`
exactly); sort/dedupe endpoints so every band is fully inside or outside each
receipt; for each band count covering YES (`Y_k`) and NO (`N_k`) receipts — a
band with either side zero **fails and retains nothing**; else `m_k =
min(Y_k,N_k)`, scarce side fully retained, crowded side prorated by
`m_k/sideCount`. Per-band cost split uses the LMSR closed forms
(`YES_cost[u,v] + NO_cost[u,v] = v − u = w_k`, the identity that makes totals
reconcile). Matched cap `F = Σ w_k·m_k`; graduate iff `F ≥ graduationThreshold`.
Summing a matched band over its covering receipts is exactly what forces the
contract's triple-equality `retainedCostTotal = matchedMarketCap =
completeSetCount = F`.

## Integer rounding policy (whitepaper open question 3)

The whitepaper leaves rounding unspecified but fixes the invariants it must
preserve exactly. The canonical v1 policy: work in the on-chain fixed-point
scale; the scarce side is exact; distribute each crowded band's retained
**shares** by **largest-remainder (Hamilton) apportionment** (ties broken by
receipt `sequence τ`, the whitepaper's tie-break hook) so they sum exactly to
`m_k·w_k`; allocate retained **cost** the same way, floor-then-remainder;
compute `refund_ℓ = cost_ℓ − retained_cost_ℓ` **last** so
`retained_cost + refund == cost` per receipt with zero drift. Rounding cost
**down** can only err toward solvency (`L ≤ F`); the largest-remainder step
restores `L = F`. Post-conditions are asserted before submit and **fail
closed** — never ship an under-collateralized root.

## Keeper decision logic (three outcomes)

Compute the sweep **offchain before touching the chain**, so a `Graduating`
market is never stranded below threshold:

- **F ≥ threshold, before deadline → graduate**: `startGraduation` →
  reconstruct the frozen book and verify it against the emitted `snapshotHash`
  → `computeBandPassClearing` → build root → `submitClearingRoot`. Covers full
  match and partial-match-with-refunds identically (difference is only the
  per-receipt numbers).
- **Deadline reached, F < threshold → refund**: `markRefundable` (never goes
  through `submitClearingRoot`, which would revert below threshold).
- **Otherwise → wait**.

Idempotency mirrors the review runner: on-chain status + lease/cursor make a
crash between `startGraduation` and `submitClearingRoot` recoverable (restart
finds `Graduating` with no root → recompute and submit).

## Test plan

Example A (whitepaper §9, `b=100`, threshold 40) is encoded as an exact fixture
at the pinned `SCALE`; Example B is qualitative (no per-receipt numbers) so a
second fixture is synthesized for a crowded-both-sides band and a fully-failed
graduation. Property tests (fast-check) over random books assert conservation
exact, share balance exact, `retainedCost ≤ retainedShares`, refunds in
`[0,cost]`, and determinism (`τ`-permutation independence except tie-break).

## Open questions / risks

Fixed-point scale of `r` vs collateral (6-decimal on Arc) must be confirmed
before coding the fixture; dust bands use threshold 0 in v1; a `Graduating`
market whose recomputed `F < threshold` should **alarm rather than submit**
(indexer/freeze race); cross-keeper determinism is deferred with the challenge
window (default 0), so this rounding is documented as the normative reference.

## Related pages

- [Graduation clearing](../concepts/graduation-clearing.md) — the mechanism this automates
- [Clearing keeper](../entities/clearing-keeper.md) — the entity this designs
- [Repo ADR 0008](root-adr-0008-protocol-functionality-completion.md) — the clearing checklist items this satisfies
- [protocol ADR 0006](protocol-adr-0006-optimistic-offchain-graduation-clearing.md) — the optimistic on-chain protocol
- [protocol ADR 0010](protocol-adr-0010-disable-the-clearing-challenge-window-by-default.md) — challenge window default 0
