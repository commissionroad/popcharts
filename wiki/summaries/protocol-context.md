---
type: summary
title: Protocol Context (Glossary)
description: The protocol glossary — virtual LMSR, receipts, path bands, band-pass clearing, graduation, matched liquidity, complete sets, and the eight-state status ladder
sources:
  - protocol/CONTEXT.md
updated: 2026-07-07
---

# Protocol Context (Glossary)

`protocol/CONTEXT.md` is a deliberately implementation-free glossary. It fixes
the protocol's vocabulary; the [Constitution](protocol-constitution.md) says
that if language drifts, docs get fixed first.

## Pre-graduation terms

- **Virtual LMSR** — the pre-graduation pricing curve. Quotes implied
  probabilities and records the price path receipts traverse. Its state is
  demand-pricing state, not sold inventory.
- **`b`** — the LMSR liquidity parameter, meaning virtual smoothness. Not a
  funded bankroll or loss budget.
- **Receipt** — a pre-graduation priced intent recording owner, side, shares,
  escrowed cost, and the exact path interval traversed. Provisional until
  graduation or refund.
- **Path** — the one-dimensional LMSR coordinate receipts traverse. YES demand
  moves it one direction, NO demand the other.
- **Price band** — an adjacent interval of the path used during clearing. A
  band graduates only when both YES and NO demand covered it in opposite
  directions.

## Clearing and graduation terms

- **Band-pass clearing** — the graduation clearing rule: pass only bands
  crossed by both sides, retain the scarce side fully, prorate the crowded
  side within each band, refund unmatched path cost. See
  [graduation clearing](../concepts/graduation-clearing.md).
- **Graduation** — the transition from provisional receipts to fully
  collateralized YES/NO complete sets, only after deterministic clearing
  proves enough path-compatible matched market cap.
- **Matched liquidity** — the path-compatible filled market cap proven by
  clearing. Explicitly *not* raw volume, total escrow, or headline open
  interest.
- **Retained cost** — the portion of a receipt's escrow assigned to graduated
  path segments, computed from those exact retained bands, not the receipt's
  average price.
- **Refund** — the escrow portion returned because path segments did not
  graduate, were crowded out, or the market missed the graduation threshold.
- **Complete set** — a fully collateralized YES/NO pair backed by one unit of
  collateral; the post-graduation fixed-payout market object. See
  [complete sets](../concepts/complete-sets.md).

## Status ladder

The contract lifecycle vocabulary is `UnderReview`, `Active`, `Rejected`,
`Graduating`, `Graduated`, `Refunded`, `Resolved`, and `Cancelled`. `Frozen`
is reserved for future suspicious-market pause behavior and is not on the
normal happy path. Product reads may group or rename states for UI, but
protocol code uses this ladder.

New markets enter `UnderReview`. Receipt quoting, placement, and graduation
all require `Active`, so no collateral can be escrowed before review approval.
Review failure moves the market to `Rejected`, where it stays closed. See
[market lifecycle](../concepts/market-lifecycle.md) and
[AI-assisted resolution](../concepts/ai-assisted-resolution.md) for the review
side of this gate.

## Related pages

- [Pregrad manager](../entities/pregrad-manager.md)
- [Mechanism whitepaper](../concepts/mechanism-whitepaper.md)
- [Summary: Constitution](protocol-constitution.md)
