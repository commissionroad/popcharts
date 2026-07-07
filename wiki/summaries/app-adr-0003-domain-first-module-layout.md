---
type: summary
title: "App ADR 0003: Domain-First Module Layout"
description: Accepted — organize the app by route/domain/feature/component/integration boundaries; pure-TS domain modules; whitepaper vocabulary becomes the codebase's shared language
sources:
  - app/docs/adr/0003-domain-first-module-layout.md
updated: 2026-07-07
---

# App ADR 0003: Use A Domain-First Module Layout

Status: **Accepted** (2026-06-13).

## Decision

Organize `app/src/` around explicit boundaries:

- `app/` — Next.js route files plus route-local loading/error/not-found
  states; routes compose features and pass data, never own product logic.
- `domain/` — `lmsr/`, `markets/`, `receipts/`, `graduation/`, `resolution/`.
  **Pure TypeScript**: no React, Next.js, browser APIs, wallet SDKs, contract
  clients, or UI imports. Owns formulas, state-machine transitions,
  invariants, and typed value objects.
- `features/` — vertical product slices (`market-discovery`, `market-create`,
  `market-detail`, `receipt-ticket`, `graduation-clearing`, `portfolio`). May
  import from domain/components/integrations/lib; shared components must not
  import from features.
- `components/` (`ui/`, `layout/`, `charts/`), `integrations/` (`wallet/`,
  `contracts/`, `indexer/`, `analytics/`), and `lib/`.

The ADR also mandates creating `app/CONTEXT.md` in the scaffold PR to record
product language for humans and agents ([summary](app-context.md)).

## The naming stance

The whitepaper's mechanism words are "not marketing copy" — they must become
the codebase's shared language. If code says `trade`, `position`, or `fill`
where the whitepaper says `receipt`, `priced intent`, or `matched segment`,
the app becomes harder to audit and easier to make dishonest. See
[mechanism whitepaper](../concepts/mechanism-whitepaper.md).

## Implementation rules

- `MarketStatus` values match design kit and whitepaper: `bootstrap`,
  `graduating`, `graduated`, `resolved`, `refunded`.
- Type names like `Receipt`, `PricedIntent`, `PriceBand`, `MatchedSegment`,
  `RefundedSegment`, `VirtualLmsrState`, `GraduationClearing`.
- Never call a pre-graduation receipt a filled position; no final
  outcome-token language until a receipt has cleared into backed complete
  sets.
- Small named functions with explicit units; branded types over naked
  `number` for cost, shares, cents, probability, collateral.
- `zod` (or equivalent) schema boundary for untrusted external data.
- LMSR pricing, band-pass clearing, and solvency invariants require unit
  tests **before** UI uses them.
- A new/updated ADR is required before making receipts transferable, changing
  the graduation threshold model, or altering the status ladder.

Note: the five-value app status ladder is a product-facing grouping. The
protocol ladder ([protocol context](protocol-context.md)) has eight states
including `UnderReview`, `Active`, `Rejected`, and `Cancelled`; the server
projection also uses `under_review` and `rejected`
([server readme](server-readme.md)). This ADR predates the review gate and
does not mention those states.

## Revisit when

The protocol/backend publishes canonical generated types/SDKs, the app becomes
a monorepo with shared packages, or domain modules become shallow wrappers.

## Related pages

- [App workspace](../entities/app-workspace.md)
- [Market lifecycle](../concepts/market-lifecycle.md)
- [Graduation clearing](../concepts/graduation-clearing.md)
- [Summary: app context glossary](app-context.md)
