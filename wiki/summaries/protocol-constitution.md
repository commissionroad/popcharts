---
type: summary
title: Protocol Constitution
description: Guiding principles for the protocol — whitepaper v4 as mechanism truth, receipt/clearing commitments, the accounting identity, stack choices, and the test-first quality bar
sources:
  - protocol/CONSTITUTION.md
updated: 2026-07-07
---

# Protocol Constitution

`protocol/CONSTITUTION.md` is the protocol's charter: the shared plan for
building Pop Charts as a Hardhat 3 Solidity protocol with crisp language,
deterministic accounting, and test-driven implementation.

## Source of truth

- The mechanism source of truth is `documents/whitepaper_v4.pdf` (_PredictFun:
  Bootstrapping Prediction Markets With Virtual LMSR And Band-Pass Graduation
  Clearing_, rev. 0.4, June 2026). Earlier whitepapers are context only —
  useful for lifecycle vocabulary and oracle modularity, but v4 supersedes
  their aggregate matching and price-bucket ideas. See
  [mechanism whitepaper](../concepts/mechanism-whitepaper.md).
- The design kit is the product-surface source of truth. Protocol reads and
  events must support a receipt-centric UI, matched-liquidity graduation bars,
  and visible band-pass clearing without ambiguous offchain reconstruction.
  See [designkit](../entities/designkit.md).

## Mechanism commitments

- Every market starts in a virtual LMSR bootstrap phase. LMSR state is
  demand-pricing state, not sold inventory; the liquidity parameter `b` is
  virtual smoothness, not a funded loss budget.
- Every pre-graduation trade creates a receipt: a locked, append-only priced
  intent over an exact path interval. Not a fill, not transferable in v1, not
  a final YES/NO token.
- Graduation freezes the receipt book and runs deterministic band-pass
  clearing. Only bands crossed by both YES and NO demand graduate; matched
  bands mint fully collateralized complete sets; everything else refunds at
  exact recorded path cost. See
  [graduation clearing](../concepts/graduation-clearing.md) and
  [complete sets](../concepts/complete-sets.md).
- The load-bearing accounting identity:

  ```txt
  receipt escrow = retained cost + refund
  locked collateral = retained market cap
  maximum winner payout <= locked collateral
  ```

  No hidden subsidy, fee, bond, insurance fund, or later revenue may be used
  to make an undercollateralized claim look solvent.

## Implementation commitments

The protocol is a Hardhat 3 project under `protocol/` (see
[protocol workspace](../entities/protocol-workspace.md)). Default stack:
pnpm, TypeScript + ESM, Hardhat 3, `@nomicfoundation/hardhat-toolbox-viem`,
OpenZeppelin Contracts, a typed fixed-point math dependency for LMSR, and
Solidity tests first with TypeScript integration tests where they add value.
The codebase should favor deep modules — math, receipt-band arithmetic,
clearing, lifecycle transitions, and token/collateral handoff stay separated
until tests prove they belong together.

## Quality bar

Before protocol logic becomes real, tests must express the whitepaper's
properties: cost-basis preservation, deterministic clearing, local collateral
completeness, full refund on non-graduation, partial fills priced by retained
path segments (not receipt averages), no final outcome token before
graduation, and no pre-graduation withdrawal or transfer in v1. Golden tests
should reproduce the worked examples in whitepaper v4. See
[testing strategy](../concepts/testing-strategy.md).

## Documentation discipline

`CONTEXT.md` is glossary-only; ADRs are for hard-to-reverse decisions with
real tradeoffs; implementation docs carry working guidance. If language
drifts, fix the docs first — names are part of the protocol.

## Related pages

- [Market lifecycle](../concepts/market-lifecycle.md)
- [Pregrad manager](../entities/pregrad-manager.md)
- [Summary: protocol context glossary](protocol-context.md)
- [Summary: ADR 0002 — whitepaper v4 as mechanism source](protocol-adr-0002-whitepaper-v4-mechanism-source.md)
