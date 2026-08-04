---
type: summary
title: Whitepaper v0.6 — Withdrawals, Fees, And Post-Graduation Seeding
description: Current mechanism source of truth (rev 0.6, August 2026) — adds the lock-the-overlap withdrawal rule and its F-invariance lemma, fees outside the solvency identity, and fee-funded seeding of the post-graduation pools
sources:
  - whitepaper/v0.6.md
  - protocol/docs/adr/0014-pre-graduation-withdrawals-and-fees.md
updated: 2026-08-04
---

# Whitepaper v0.6

_Pop Charts: A No-Subsidy Use Of LMSR For Prediction Market Bootstrapping_,
rev. 0.6, August 2026. **The mechanism source of truth**
([protocol ADR 0002](protocol-adr-0002-whitepaper-v4-mechanism-source.md)), and
the first revision to live in the repo as markdown rather than only as a PDF —
see [`whitepaper/`](../../whitepaper/README.md).

Lineage: v0.6 is v0.5 plus withdrawals and fees. v0.5 was an unpublished
shortened rewrite of v0.4 that replaced the informal solvency argument with
Lemmas 1–2 and the exact-collateralization theorem; v0.4 is the published
`documents/whitepaper_v4.pdf` and the subject of
[whitepaper v4 summary](whitepaper-v4.md), which remains accurate for
everything v0.6 did not change. Also renamed from "PredictFun" to Pop Charts.

## What is unchanged from v4/v0.5

Virtual LMSR pricing over demand-state `q_yes`/`q_no` with virtual `b` (§3);
receipts as priced path intervals with exact path-integral cost (§4); the
band-pass sweep, `m_k = min(Y_k, N_k)`, scarce side whole and crowded side
pro-rata (§5); Lemma 1 (local funding identity), Lemma 2 (balanced complete
sets), and the exact-collateralization Theorem `L = F` (§6); fill bounds and
the worked Example A (§8–§9). See [graduation clearing](../concepts/graduation-clearing.md)
and [complete sets](../concepts/complete-sets.md).

## The withdrawal rule (§4)

Replaces "Rights, And The No-Withdrawal Tradeoff". A band of a receipt is
**opposed** once any live opposite-side receipt covers it. Opposed bands lock
for both receipts until clearing; every other band may be withdrawn before the
freeze, refunding that band's own recorded path cost less the withdrawal fee.

The rule turns on a distinction the earlier drafts did not draw:

- **Retention** (`φ_{σ,k} = m_k / Y_k`) is *not* monotone — it falls when a
  same-side receipt arrives and rises when an opposite-side one does. It is a
  running estimate of an election not yet held, so nothing about it can be
  vested. This is why "refund the unmatched part" cannot be built.
- **Opposition** *is* monotone — nothing un-opposes a band, because withdrawal
  can only remove unopposed capital.

The rule is conservative by construction: an unopposed band has `m_k = 0` and
was already certain to refund in full, so the released set is strictly smaller
than the eventual refund (bands where the holder's side is crowded also partly
refund, and those stay locked).

v0.4's two stated justifications for the blanket lock are retired as wrong:
solvency (a virtual LMSR has no pool to drain — escrow is per-receipt) and
determinism (the sweep is deterministic because the book is *frozen at
clearing*, not because it was append-only before). The genuine objection,
unstated in v0.4, is the graduation veto, and Lemma 3 removes it.

## Lemma 3 — withdrawal invariance (§6)

For an unopposed sub-band `B_j ⊆ I_ℓ` with opposite-side count zero:
`m_j = min(Y_j, 0) = 0` before and `min(Y_j − 1, 0) = 0` after, so the band's
contribution to `F` is zero on both sides and by Lemma 1 its retained
collateral is zero on both sides. No other band's covering counts change.
Hence `F`, `L`, and every other receipt's outcome are unchanged.

**Corollary:** graduation (`F ≥ threshold`) is immune to withdrawal. No holder
holds a veto, and the freeze-versus-withdraw race has no payoff.

The lemma also fixes the boundary: the rule **cannot** be loosened to "whatever
clearing would refund". On a crowded band (`m_k ≥ 1`), removing a YES receipt
either silently raises surviving holders' fractions (`Y_k > N_k`) or lowers `F`
outright (`Y_k ≤ N_k`).

Receipts become **finite unions of intervals** — withdrawing an interior band
splits one. The proof is indifferent (it only uses the band partition); the
implementation is not.

## Fees and seeding (§7, new)

Two fees, both **outside escrow**: an entry fee `φ_in` on a receipt's cost at
purchase, and a withdrawal fee `φ_out` on a withdrawn band's recorded cost. The
identity becomes `E = R + L + Φ`, with `E − Φ = R + L` unchanged over escrow
alone. A fee taken out of `L` or netted against refunds is forbidden — `L = F`
has no slack. This satisfies v4's own explicit-fee constraint; see
[creation-fee custody](../concepts/creation-fee-custody.md).

What `φ_out` buys is narrow: not solvency (Lemma 3), not pump-and-withdraw
protection (the lock rule forecloses it — the pump commits the moment anyone
responds), but only the residue of moving the display and retracting it while
nobody responds. That harm is external, so nothing inside the mechanism
calibrates the rate. The cost of walking `P_0 → P_1` and retracting is
`φ_out · b · ln((1−P_0)/(1−P_1))` — the fee multiplies the curve's own
resistance, so `b` stays the primary control.

**Seeding.** At graduation the fee pot `Φ` seeds the two post-graduation pools.
Requiring each pool to be balanced at the clearing price `p*` fixes the split
rather than leaving it to choice: `c_Y = m·p*` and `c_N = m(1−p*)` give
`c_Y + c_N = m`, and the budget `c_Y + c_N = Φ − m` forces `m = Φ/2`. So mint
`Φ/2` complete sets, seed `Φ/2` YES with `(Φ/2)p*`, and `Φ/2` NO with
`(Φ/2)(1−p*)`. Fully backed, additive to the `F` sets clearing produced.

**Seeded liquidity does not survive resolution.** A full-range position seeded
at 35% ends resolution worth ~88% of holding if YES wins and **~5% if YES
loses** — structural, since the losing token goes to zero and the pool holds
most of it. Protocol liquidity must be withdrawn before resolution or bounded
tightly; see [postgrad v4 venue](../entities/postgrad-v4-venue.md).

## Limitations added (§10)

Opposed capital is still locked (~86% of a book in simulation); receipts are no
longer single intervals; being opposed is a way to be pinned (at the
complement of what the holder paid, so it is trading rather than griefing — but
cheap near the top of the book); and `φ_out` is uncalibrated. Transferability
is noted as the same question wearing different clothes — a transfer changes no
band's covering counts, so `F` is invariant by inspection — with refund
ownership across fragmented receipts as the real blocker.

## Related pages

- [Mechanism whitepaper](../concepts/mechanism-whitepaper.md)
- [Whitepaper v4](whitepaper-v4.md) — the published predecessor
- [Whitepaper history](whitepaper-history.md)
- [Protocol ADR 0014](protocol-adr-0014-pre-graduation-withdrawals-and-fees.md)
- [Graduation clearing](../concepts/graduation-clearing.md)
