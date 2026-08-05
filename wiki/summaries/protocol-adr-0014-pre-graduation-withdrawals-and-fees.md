---
type: summary
title: "ADR 0014: Pre-Graduation Withdrawals, Fees, And Post-Graduation Seeding"
description: Proposed — lock-the-overlap withdrawals (F provably invariant), segment-list receipts, a 1% entry fee that is really a success fee (earned only on matched cost), 5% withdrawal penalty, protocol-topped pool seeding, and the LP-fee-untouched post-graduation split
sources:
  - protocol/docs/adr/0014-pre-graduation-withdrawals-and-fees.md
  - whitepaper/v0.6.md
updated: 2026-08-05
---

# ADR 0014: Pre-Graduation Withdrawals, Fees, And Post-Graduation Seeding

**Status: Proposed.** Supersedes the non-withdrawable half of
[ADR 0003](protocol-adr-0003-v1-receipts-locked-non-transferable.md); receipts
stay non-transferable.

## Why the old lock was wrong

Whitepaper v0.4 §4 gave two reasons, and the ADR retires both against the
implementation:

- **Solvency** imports intuition from a *funded* LMSR with a pooled reserve. A
  virtual LMSR has no pool; escrow is per-receipt, so returning a receipt's own
  recorded cost leaves `E = R + L` intact.
- **Determinism** comes from freezing the book at clearing, not from
  append-only before it. `computeBandPassClearing` reads only `rLow`, `rHigh`,
  `side`, `cost`, `shares`, `sequence` — never `market.state.path`.

The real objection was unstated: unrestricted withdrawal is a **veto on
graduation**. Simulated over random books, the largest holder walking out
erases ~13% of `F` on average and up to 100% in small books — precisely the
regime the bootstrap phase serves.

## Decisions

1. **Lock the overlap.** A band is *opposed* once any live opposite-side
   receipt covers it; opposed bands lock for both, unopposed bands are
   withdrawable before the freeze at their own recorded path cost. Safe because
   opposition is monotone where retention (`m_k/Y_k`) is not. Measured change
   in `F` over 398 random books: exactly zero. **Explicitly may not be loosened
   to "whatever clearing would refund"** — that set touches crowded bands and
   either redistributes others' fills or lowers `F`.
2. **Segment-list receipts.** Withdrawal splits intervals, so `rLow`/`rHigh`
   become a finite union. Measured fragmentation ≤ 2 segments, unbounded in
   theory, so the contract must cap it.
3. **The entry fee is a success fee, and a second escrow.** `φ_in` = 1% is
   charged on the whole receipt at purchase but **earned only on the part that
   matches**, so the protocol keeps exactly `φ_in · F` (because `L = F`) and
   every refunded unit returns carrying the fee prepaid on it. A market that
   fails to graduate, or is cancelled, refunds the entry fee in full. `φ_out` =
   5% on withdrawal is the only unconditionally earned money. Collecting up
   front is **forced**: a fully filled receipt has no refund to bill against,
   and taking it from `L` breaks `L = F`. Consequences — it cannot use the
   `CreationFeeVault` shape (the owner must not be able to withdraw money that
   may go back to traders), and the paid fee must be **stored on the receipt,
   not derived**, or a later `φ_in` change would repay the wrong rate.
4. **Seeding is protocol-topped, not fee-funded.** Balance at `p*` forces the
   split (mint `Φ/2` sets, seed `Φ/2` YES + `(Φ/2)p*` and `Φ/2` NO +
   `(Φ/2)(1−p*)`), but fees alone cannot fill it: depth per side is `φ_in/2` of
   matched cap, so 5% depth would need a 10% fee. The pot is topped up from
   protocol capital to **10% of the graduation threshold** — on Example A the
   subsidy does 9× what the fees do, taking depth from 0.5% to 5.0% of cap.
5. **Post-graduation: LPs keep the whole LP fee.** The protocol takes only
   v4's native protocol fee, capped at **0.1%** (`MAX_PROTOCOL_FEE = 1000`,
   read from vendored v4-core). No hook fee — both swap callbacks keep
   returning zero deltas — and no mint fee, which is avoidable anyway and would
   widen the keeper's `YES + NO ≈ 1` arb band to **±2%**. Any future mint fee
   must ship with a keeper exemption in the same change.
6. **Creator earns from both surfaces.** 10% of the success fee at graduation,
   plus a share of the 0.1% protocol fee. The second needs **off-chain
   attribution**: `ProtocolFees.sol` accrues per *currency*, not per pool, so
   there is no on-chain link from fees to a market or creator. Trusted but
   reproducible from indexed swap volume; the trustless alternative is a hook
   fee, rejected above.

## The seeding caveat

Seeded liquidity is destroyed by resolution — a full-range position seeded at
35% is worth ~88% of holding if YES wins and **~5% if YES loses**. The ADR
therefore requires a pre-resolution unwind and states that **P5 (seeding) must
not ship without P6 (unwind)**. Seeding is a service to traders funded by their
own fees, not a treasury asset.

## Phases

P1 segmented receipts (behaviour-preserving) → P2 off-chain opposition split
and withdrawal quote with golden tests → P3 on-chain `withdrawReceiptBands` →
P4 fees and the `E = R + L + Φ` invariant → P5 graduation seeding → P6
pre-resolution unwind. All open.

## Deferred

Fee charged on width rather than cost (better targeted at display manipulation);
a hard fragmentation bound (the 2-segment figure is empirical); transferability
(blocked on refund ownership for fragmented receipts); seeding range selection;
`φ_in`/`φ_out` calibration; and the fee pot's disposition under
[`cancelMarket`](protocol-adr-0011-admin-market-cancellation.md).

## Related pages

- [Whitepaper v0.6](whitepaper-v6.md) — §4 rule, §6 Lemma 3, §7 fees and seeding
- [PregradManager](../entities/pregrad-manager.md) — the contract that changes
- [Graduation clearing](../concepts/graduation-clearing.md)
- [Postgrad v4 venue](../entities/postgrad-v4-venue.md) — the seeding target
- [Creation-fee custody](../concepts/creation-fee-custody.md) — the other fee surface
