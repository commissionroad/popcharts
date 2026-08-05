---
type: concept
title: Graduation clearing (band-pass)
description: The core mechanism — deterministic band-pass clearing over the frozen receipt book, committed optimistically as a Merkle root, preserving E = R + L exactly; withdrawals of unopposed bands provably leave the matched cap untouched.
sources:
  - whitepaper/v0.6.md
  - documents/whitepaper_v4.pdf
  - protocol/docs/adr/0014-pre-graduation-withdrawals-and-fees.md
  - protocol/docs/adr/0006-use-optimistic-offchain-graduation-clearing.md
  - protocol/CONSTITUTION.md
  - protocol/CONTEXT.md
  - docs/adr/0008-protocol-functionality-completion.md
updated: 2026-08-04
---

# Graduation clearing

Pop Charts' central invention (whitepaper v4 §6, proved in v0.6 §6): when a
market graduates, only price bands crossed by **both** YES and NO demand
convert to real outcome tokens; everything else refunds at exact recorded cost.

**The sweep reads only the receipt intervals** — `rLow`, `rHigh`, `side`,
`cost`, `shares`, `sequence` — never the live curve state `market.state.path`.
That is what makes pre-freeze withdrawal safe at all: a withdrawal deletes a
row (or shortens one) from the book the sweep will later replay, and every
remaining row clears identically. Determinism comes from freezing the book at
clearing, not from the book having been append-only before it.

**Withdrawal invariance (v0.6 Lemma 3).** A band no opposite-side receipt
covers has `m_k = min(Y_k, 0) = 0` before a withdrawal and `min(Y_k − 1, 0) = 0`
after, so `F` and `L` are unchanged and no other receipt's outcome moves.
Graduation is therefore immune to withdrawal — nobody holds a veto, and the
freeze-versus-withdraw race has no payoff. The rule cannot be loosened to
"whatever clearing would refund": on a crowded band that either redistributes
other holders' fills or lowers `F`. See
[protocol ADR 0014](../summaries/protocol-adr-0014-pre-graduation-withdrawals-and-fees.md).

Receipts are consequently **finite unions of intervals**, not single intervals,
once withdrawal exists — the proof is indifferent (it only uses the band
partition), the implementation is not.

## The algorithm (deterministic endpoint sweep)

Over the frozen receipt book: receipt intervals on `r = q_yes − q_no` →
sorted deduped endpoints → per-band coverage counts `Y_k`/`N_k` → a band
fails if either side is 0 → retain the scarce side fully, prorate the crowded
side by `m_k = min(Y_k, N_k)` → refund all unretained path cost → matched
market cap `F = Σ w_k·m_k` decides graduation against the threshold.
Proration scales shares and cost by the same fraction — it changes quantity,
never per-share price. Retained cost comes from exact retained bands, never
receipt averages.

**Conservation** (the accounting identity, restated in the protocol
constitution): `escrow E = retained cost R + locked collateral L`, `L = F`,
max winner payout ≤ L, per-receipt `retained_cost + refund = cost`. Locally
per band: YES cost + NO cost = band width = complete sets minted — no band is
solvent at another band's expense. No fees exist in the identity; any future
fee must appear explicitly (`E = R + L + fees`).

Clearing is **time-symmetric**: coverage clears, not order. Whitepaper v4 §5
documents why every coarser scheme fails (global proration, average-price
fills, virtual reserves); §8 bounds fill outcomes (worst case full refund,
effective price within the bettor's own range, no socialized loss). Example B
is the anti-manipulation result: painting the curve without opposing flow
becomes the manipulator's own refund — "information is not collateral."

## Onchain protocol (optimistic, [protocol ADR 0006](../summaries/protocol-adr-0006-optimistic-offchain-graduation-clearing.md))

`startGraduation` locks receipt count + LMSR state → offchain compute →
`submitClearingRoot` (root + matchedMarketCap, refundTotal,
retainedCostTotal, completeSetCount; totals must pass escrow conservation) →
challenge window (owner-configurable `clearingChallengePeriod`, default 0 per
[protocol ADR 0010](../summaries/protocol-adr-0010-disable-the-clearing-challenge-window-by-default.md);
bonds/fraud proofs deferred to mainnet)
→ `finalizeGraduation` funds the [adapter](../entities/postgrad-adapter.md)
(capacity asserted, `PostgradCapacityMismatch`) → one-time per-receipt Merkle
claims. Anyone may freeze an eligible market.

## Status

Math verified by whitepaper golden examples (A and B, v4 §9); onchain path
implemented in [PregradManager](../entities/pregrad-manager.md); the automating
[clearing keeper](../entities/clearing-keeper.md) is **built** — its whole
clearing block in
[root ADR 0008](../summaries/root-adr-0008-protocol-functionality-completion.md)
closed on 2026-07-13 (runnable keeper, whitepaper Example A pinned as a golden
test, full outcome space including automatic `markRefundable` for no-match
markets at the deadline). Two caveats carry: the keeper is **poll-based**, not a
`GraduationStarted` watcher, and the automated pass is still **gated to the local
network** with dev tools enabled — elsewhere, no-match refunds rely on the
permissionless on-chain `markRefundable` plus the `MarketRefundsAvailable`
watcher.

A market can also leave this path entirely: an operator can
[cancel an Active market](../summaries/protocol-adr-0011-admin-market-cancellation.md)
for content moderation, which refunds all escrow and never clears.

UI surfaces exist (GraduationBar, BandStrip) but BandStrip still renders static
demo bands.
