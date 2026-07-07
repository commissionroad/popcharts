---
type: summary
title: Protocol Testing Strategy
description: Two-layer Hardhat 3 test approach — Solidity tests for unit/invariant behavior, TypeScript for orchestration — plus whitepaper-v4 golden tests and the pre-handoff verification commands.
sources:
  - protocol/docs/TESTING.md
updated: 2026-07-07
---

# Protocol Testing Strategy

How the [protocol workspace](../entities/protocol-workspace.md) tests
contracts. Hardhat 3 supports two useful layers; both are used intentionally.
This is the protocol slice of the program-wide
[testing strategy](../concepts/testing-strategy.md).

## Solidity tests (unit behavior — the default)

LMSR quote/cost functions, path interval arithmetic, receipt accounting,
clearing band math, lifecycle transition guards, fuzz and invariant checks.
Uses `forge-std/Test.sol` assertions and cheatcodes.

## TypeScript tests (offchain orchestration and integration)

Factory deployment, viem typed contract interaction, fixture reuse,
event/read-model checks, and manager deployment plus end-to-end market flows.
Uses Node's built-in test runner, `node:assert/strict`, `network.create()`,
and viem helpers from `@nomicfoundation/hardhat-toolbox-viem`.

## Golden tests from whitepaper v4

Before implementing real clearing, golden tests derived from the
[mechanism whitepaper](../concepts/mechanism-whitepaper.md) v4:

- Example A: three traders, one graduation
- Example B: large drift is not backfilled

They verify retained shares, retained cost, refunds, matched market cap, and
collateral completeness — the core outputs of
[graduation clearing](../concepts/graduation-clearing.md).

Status note: the doc says "before implementing real clearing"; clearing has
since been implemented in `PregradManager` (root submission, finalization,
Merkle claims exist per later plan docs), so verify against the test suite
whether these golden tests landed as described.

## Verification commands before handoff

```bash
pnpm format:check
pnpm lint:sol
pnpm build
pnpm typecheck
pnpm test
```

## Related pages

- [protocol workspace](../entities/protocol-workspace.md)
- [testing strategy](../concepts/testing-strategy.md)
- [graduation clearing](../concepts/graduation-clearing.md)
- [mechanism whitepaper](../concepts/mechanism-whitepaper.md)
