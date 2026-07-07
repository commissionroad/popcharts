---
type: summary
title: App Context (Product Glossary)
description: The frontend's product-language glossary — market, virtual LMSR, priced intent, receipt, price band, band-pass clearing, matched/refunded segments, graduation, complete set, resolution
sources:
  - app/CONTEXT.md
updated: 2026-07-07
---

# App Context (Product Glossary)

`app/CONTEXT.md` is the frontend's shared-language file, created per app
ADR 0003's instruction. It defines each product term together with the words
to *avoid*, so UI copy and type names stay honest about the mechanism. It is
the app-side counterpart of the protocol glossary
([protocol context](protocol-context.md)).

Pop Charts is framed in one line: a no-liquidity prediction-market launchpad
where markets discover demand on a virtual LMSR curve before graduating into
fully backed YES/NO complete sets.

## Term / avoid pairs

- **Market** — a binary question with lifecycle, displayed probability,
  receipts, and a path toward graduation. *Avoid: pool, event.*
- **Virtual LMSR** — the pre-graduation pricing curve; `b` controls smoothness
  but is not backed by a protocol bankroll. *Avoid: funded market maker,
  liquidity pool.*
- **Priced intent** — a pre-graduation buy priced by the virtual LMSR; records
  demand, is not a final outcome-token fill. *Avoid: fill, final trade.*
- **Receipt** — the user's record of a priced intent: side, cost, shares, and
  the price band traversed, while capital waits for clearing or refund.
  *Avoid: position, share.*
- **Price band** — the probability interval swept by a receipt along the LMSR
  path. *Avoid: range, bucket.*
- **Band-pass clearing** — the graduation rule that passes bands traversed by
  both YES and NO demand in opposite directions. *Avoid: matching engine,
  auction.* See [graduation clearing](../concepts/graduation-clearing.md).
- **Matched segment** — the portion of a receipt that clears into fully
  collateralized complete sets. *Avoid: guaranteed fill.*
- **Refunded segment** — the portion that does not clear, returned at exact
  path cost. *Avoid: loss, failed trade.*
- **Graduation** — the transition from receipts into backed outcome tokens
  when enough compatible opposing demand exists. *Avoid: launch, listing.*
- **Complete set** — a fully collateralized YES/NO pair backing fixed-payout
  outcome tokens after graduation. *Avoid: virtual share.* See
  [complete sets](../concepts/complete-sets.md).
- **Resolution** — the post-graduation truth outcome. *Avoid: graduation* —
  the two transitions must not be conflated.

## Related pages

- [App workspace](../entities/app-workspace.md)
- [Market lifecycle](../concepts/market-lifecycle.md)
- [Summary: app ADR 0003 — domain-first module layout](app-adr-0003-domain-first-module-layout.md)
