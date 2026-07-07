---
type: concept
title: Testing strategy
description: Layered testing across workspaces — Solidity-first protocol tests with whitepaper golden examples, app property tests, smoke tiers, and the full-lifecycle e2e suite as launch gate.
sources:
  - protocol/docs/TESTING.md
  - protocol/CONSTITUTION.md
  - app/docs/adr/0004-testing-and-ci-gates.md
  - docs/adr/0014-full-lifecycle-e2e-testing.md
  - README.md
updated: 2026-07-07
---

# Testing strategy

## Protocol

Two layers: Solidity (forge-std) for unit/fuzz/invariant behavior —
LMSR math, path intervals, receipt accounting, clearing band math, lifecycle
guards — and TypeScript (node test runner + viem) for orchestration.
Required property tests (constitution): cost-basis preservation,
deterministic clearing, local collateral completeness, full refund on
non-graduation, segment-priced partial fills, no pre-graduation outcome
token/withdrawal/transfer, singleton market isolation. **Golden tests**
reproduce whitepaper v4 worked Examples A and B; ADR 0009 adds golden tests
for both currency sort orders before Arc deployment
(`test/solidity/LocalV4StackSmoke.t.sol` runs 18-dec outcomes vs 6-dec
collateral). Note: `protocol/docs/TESTING.md` predates landed clearing —
whether the Example A/B golden tests exist as described is a lint item.

## App ([app ADR 0004](../summaries/app-adr-0004-testing-and-ci-gates.md))

Strict TS, ESLint, Vitest, RTL, fast-check property tests (LMSR/clearing/
solvency), Playwright + visual snapshots, axe. Required on every app PR:
lint, typecheck, unit, e2e-smoke. Test-first for domain code; never mock the
domain layer; honesty-rule copy is tested
([product honesty rule](product-honesty-rule.md)).

## Cross-stack tiers

- `just app-check` / `protocol-check` / `server-check` / `check` / `test`
- `just devchain-e2e` — chain-backed Playwright `@chain` smoke
- `just local-smoke` — create→index→API through the real stack
- `just local-market-health` (collateral invariant) and `just
  local-market-smoke` (maker/taker/arb/resolution) — postgrad venue flows
- `just server-ai-review-smoke` — DB→service→DB heuristic review cycle
- CI freshness gates: `metadata:check`, `openapi:check`, `api:check`

## Target ([root ADR 0014](../summaries/root-adr-0014-full-lifecycle-e2e-testing.md), all open)

One-command full-stack suite driving markets from creation to **every**
terminal state (happy + unhappy paths + infra failure drills) on the
[devchain](../entities/devchain.md); heuristic provider for determinism,
real-Anthropic smoke opt-in only; default CI stays at smoke tier. This suite
is the acceptance gate for milestones M1–M4 and the Arc launch.
