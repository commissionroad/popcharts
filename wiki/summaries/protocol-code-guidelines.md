---
type: summary
title: Protocol Code Guidelines
description: Solidity conventions and security posture for the protocol workspace — thin external functions, math in libraries, immutable market config, and hard pre-graduation invariants.
sources:
  - protocol/docs/CODE_GUIDELINES.md
updated: 2026-07-07
---

# Protocol Code Guidelines

Coding standards for the [protocol workspace](../entities/protocol-workspace.md).
Not a plan doc — these are standing rules.

## General

- Use the domain language in `protocol/CONTEXT.md`; no synonyms for core
  concepts unless the glossary changes first.
- Keep modules deep: small interfaces, tricky accounting hidden behind tests.
- No speculative extensibility — abstractions only when they remove real
  complexity or protect a protocol invariant.

## Solidity conventions

- Explicit custom errors, never generic revert strings.
- OpenZeppelin for standards (ERC-20, ownership, safe transfer helpers).
- NatSpec triple-slash comments everywhere; `@notice` for protocol semantics
  (feeds generated docs, e.g. `solidity-docgen`), `@dev` for implementation
  constraints.
- External functions stay thin: validate inputs → update state → emit events →
  bounded external interactions. Math and clearing logic live in libraries with
  focused unit tests; contracts orchestrate.
- Prefer immutable deployment configuration for market-defining values:
  collateral token, creator, metadata hash, opening probability, `b`,
  graduation threshold, graduation deadline, resolution deadline.
- Document only non-obvious accounting/security constraints.

## Events and reads

Events and view methods serve the product surface (creation, receipt
placement, path interval and cost basis, graduation start and clearing root,
matched market cap, retained shares/cost, refunds, graduation, resolution) —
the [indexer](../entities/indexer.md) must never have to infer core state from
ambiguous names.

## Security posture

Hard invariants of the [market lifecycle](../concepts/market-lifecycle.md):

- No final fixed-payout exposure before graduation.
- No receipt withdrawal or transfer in v1.
- No clearing path may create a claim whose maximum payout exceeds locked
  collateral (see [graduation clearing](../concepts/graduation-clearing.md)).
- No later resolution or post-graduation venue may rescue an
  undercollateralized bootstrap market.
- Checks-effects-interactions, guarded transfers, deterministic rounding, and
  explicit dust policy once clearing math is implemented.

## Related pages

- [protocol workspace](../entities/protocol-workspace.md)
- [pregrad manager](../entities/pregrad-manager.md)
- [market lifecycle](../concepts/market-lifecycle.md)
- [graduation clearing](../concepts/graduation-clearing.md)
- [testing strategy](../concepts/testing-strategy.md)
