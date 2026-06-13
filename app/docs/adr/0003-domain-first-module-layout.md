# ADR 0003: Use A Domain-First Module Layout

Status: Accepted

Date: 2026-06-13

## Context

The whitepaper is precise about the mechanism:

- Markets start in Bootstrap on a virtual LMSR curve.
- Pre-graduation bets are priced intents recorded as receipts.
- Receipts cover exact price/path bands.
- Graduation uses band-pass clearing to pass only path-compatible YES and NO
  demand into fully collateralized complete sets.
- Unmatched segments are refunded at exact path cost.
- The status ladder is Bootstrap, Graduating, Graduated, Resolved, with
  Refunded for cancelled or expired markets.

These words are not marketing copy. They should become the codebase's shared
language. If the implementation uses vague names like `trade`, `position`, or
`fill` in places where the whitepaper says `receipt`, `priced intent`, or
`matched segment`, the app will become harder to audit and easier to make
dishonest.

The mattpocock/skills guidance reinforces this: shared language, ADRs, and
architecture reviews make agent-assisted development less verbose and less
muddy.

## Decision

Organize the app around explicit boundaries:

```txt
app/src/
  app/
    (markets)/
    create/
    portfolio/
  domain/
    lmsr/
    markets/
    receipts/
    graduation/
    resolution/
  features/
    market-discovery/
    market-create/
    market-detail/
    receipt-ticket/
    graduation-clearing/
    portfolio/
  components/
    ui/
    layout/
    charts/
  integrations/
    wallet/
    contracts/
    indexer/
    analytics/
  lib/
    env.ts
    format.ts
    invariant.ts
```

`domain/` contains pure TypeScript and must not import React, Next.js, browser
APIs, wallet SDKs, contract clients, or UI components. It owns formulas,
state-machine transitions, invariants, and typed value objects.

`features/` contains product flows and feature-specific UI. A feature may import
from `domain/`, `components/`, `integrations/`, and `lib/`, but shared UI
components must not import from features.

`app/` contains Next.js route files and route-local loading/error/not-found
states. Route files compose features and pass data; they do not own product
logic.

Create `app/CONTEXT.md` during the scaffold PR. It should explain the product
language for humans and agents, starting with the whitepaper terms above.

## Consequences

Positive:

- Domain rules become testable without React, wallet mocks, or browser setup.
- UI can stay honest because it speaks the same words as the whitepaper.
- Features can be built as vertical slices without turning route files into
  giant components.
- Integrations can change without rewriting the product model.

Tradeoffs:

- The first scaffold has more directories than a tiny prototype.
- Engineers have to choose between `domain/`, `features/`, `components/`, and
  `integrations/` rather than dropping everything next to a route.
- Some duplication is acceptable early if extracting a shared abstraction would
  blur product boundaries.

## Implementation Rules

- Use `MarketStatus` values that match the design kit and whitepaper:
  `bootstrap`, `graduating`, `graduated`, `resolved`, `refunded`.
- Use `Receipt`, `PricedIntent`, `PriceBand`, `MatchedSegment`,
  `RefundedSegment`, `VirtualLmsrState`, and `GraduationClearing` style names
  where those concepts are present.
- Do not call a pre-graduation receipt a filled position.
- Do not expose final outcome-token language until a receipt has cleared into
  backed YES/NO complete sets.
- Keep calculations in small named functions with explicit units. Avoid naked
  `number` when a branded type or object makes cost, shares, cents, probability,
  or collateral units clearer.
- Use `zod` or an equivalent schema boundary for untrusted external data once
  integrations arrive.
- Any implementation of LMSR pricing, band-pass clearing, or solvency
  invariants needs unit tests before it is used by UI.
- Add a short ADR or update this one before making receipts transferable,
  changing the graduation threshold model, or altering the status ladder.

## Revisit When

- The protocol/backend publishes canonical generated types or SDKs.
- The app becomes a monorepo with shared packages for contracts, indexers, or
  multiple clients.
- Domain modules become shallow wrappers instead of meaningful boundaries.
