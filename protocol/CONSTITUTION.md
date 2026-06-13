# Pop Charts Protocol Constitution

This document is the protocol's guiding principle. It records the shared plan
for building Pop Charts as a Hardhat 3 Solidity protocol with crisp language,
deterministic accounting, and test-driven implementation.

## Source Of Truth

The source of truth for the mechanism is `../documents/whitepaper_v4.pdf`:
_PredictFun: Bootstrapping Prediction Markets With Virtual LMSR And Band-Pass
Graduation Clearing_, rev. 0.4, June 2026.

Earlier whitepapers are context only. They are useful for lifecycle vocabulary,
oracle modularity, and historical design pressure, but v4 supersedes their
aggregate matching and price-bucket ideas.

The design kit is the product-surface source of truth. It makes one thing
especially clear: protocol reads and events must support a receipt-centric UI,
matched-liquidity graduation bars, and visible band-pass clearing without
ambiguous offchain reconstruction.

## Mechanism Commitments

Pop Charts starts each market in a virtual LMSR bootstrap phase. The LMSR state
is demand-pricing state, not sold inventory. The liquidity parameter `b` is
virtual smoothness, not a funded loss budget.

Every pre-graduation trade creates a receipt. A receipt is a locked, append-only
priced intent over an exact path interval. It is not a fill, not transferable in
v1, and not a final YES/NO token.

Graduation freezes the receipt book and runs deterministic band-pass clearing.
Only path bands crossed by both YES and NO demand in opposite directions can
graduate. Matched bands mint fully collateralized complete sets. Every unmatched
or crowded-out path segment refunds at its exact recorded path cost.

The protocol's accounting identity is load-bearing:

```txt
receipt escrow = retained cost + refund
locked collateral = retained market cap
maximum winner payout <= locked collateral
```

No hidden subsidy, fee, bond, insurance fund, or later revenue source may be
used to make an undercollateralized claim look solvent.

## Implementation Commitments

The protocol is a Hardhat 3 project under `protocol/`.

The default stack is:

- `pnpm`
- TypeScript and ESM
- Hardhat 3
- `@nomicfoundation/hardhat-toolbox-viem`
- OpenZeppelin Contracts for standards
- a typed fixed-point math dependency or tightly wrapped math library for LMSR
- Solidity tests first, TypeScript integration tests where they add value

The codebase should favor deep modules: small public interfaces, explicit
domain names, and complexity hidden behind well-tested libraries. Math,
receipt-band arithmetic, clearing, lifecycle transitions, and token/collateral
handoff should stay separated until tests prove they belong together.

## Quality Bar

Before protocol logic becomes real, it needs tests that express the whitepaper's
properties:

- cost-basis preservation
- deterministic clearing
- local collateral completeness
- full refund on non-graduation
- partial fills priced by retained path segments, not receipt averages
- no final outcome token before graduation
- no pre-graduation withdrawal or transfer in v1

Golden tests should reproduce the worked examples in v4 before the protocol is
trusted.

## Documentation Discipline

Use `CONTEXT.md` for glossary terms only. Use ADRs for hard-to-reverse decisions
that involve real tradeoffs. Use implementation docs for working guidance,
testing strategy, and contributor workflow.

If language drifts, fix the docs first. Names are part of the protocol.
