---
type: concept
title: Graduation clearing (band-pass)
description: The core mechanism — deterministic band-pass clearing over the frozen receipt book, committed optimistically as a Merkle root, preserving E = R + L exactly.
sources:
  - documents/whitepaper_v4.pdf
  - protocol/docs/adr/0006-use-optimistic-offchain-graduation-clearing.md
  - protocol/CONSTITUTION.md
  - protocol/CONTEXT.md
  - docs/adr/0008-protocol-functionality-completion.md
updated: 2026-07-07
---

# Graduation clearing

Pop Charts' central invention (whitepaper v4 §6): when a market graduates,
only price bands crossed by **both** YES and NO demand convert to real
outcome tokens; everything else refunds at exact recorded cost.

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
challenge window (timeout-only in v1; bonds/fraud proofs deferred to mainnet)
→ `finalizeGraduation` funds the [adapter](../entities/postgrad-adapter.md)
(capacity asserted, `PostgradCapacityMismatch`) → one-time per-receipt Merkle
claims. Anyone may freeze an eligible market.

## Status

Math verified by whitepaper golden examples (A and B, v4 §9); onchain path
implemented in [PregradManager](../entities/pregrad-manager.md); the
automating [clearing keeper](../entities/clearing-keeper.md) is unbuilt (all
[root ADR 0008](../summaries/root-adr-0008-protocol-functionality-completion.md)
items open). UI surfaces exist (GraduationBar, BandStrip) but BandStrip still
renders static demo bands.
