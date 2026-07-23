---
type: concept
title: Testing strategy
description: Layered testing across workspaces — Solidity-first protocol tests with whitepaper golden examples, app property tests, smoke tiers, and the full-lifecycle e2e suite as launch gate.
sources:
  - protocol/docs/TESTING.md
  - protocol/CONSTITUTION.md
  - app/docs/adr/0004-testing-and-ci-gates.md
  - docs/adr/0014-full-lifecycle-e2e-testing.md
  - docs/adr/0017-test-observability-and-coverage-program.md
  - docs/adr/0019-ai-verdict-quality-program.md
  - README.md
updated: 2026-07-22
---

# Testing strategy

## Protocol

Two layers: Solidity (forge-std) for unit/fuzz/invariant behavior —
LMSR math, path intervals, receipt accounting, clearing band math, lifecycle
guards — and TypeScript (node test runner + viem) for orchestration.
Required property tests (constitution): cost-basis preservation,
deterministic clearing, local collateral completeness, full refund on
non-graduation, segment-priced partial fills, no pre-graduation outcome
token/withdrawal/transfer, singleton market isolation. ADR 0009 adds golden
tests for both currency sort orders before Arc deployment
(`test/solidity/LocalV4StackSmoke.t.sol` runs 18-dec outcomes vs 6-dec
collateral).

**Whitepaper golden tests — resolved 2026-07-14** (this was an open lint item;
`protocol/docs/TESTING.md` predates landed clearing and describes them
aspirationally). They exist, but not where the doc implies: they live in
**`server/src/keeper/clearing/band-pass-clearing.test.ts`**, not in the protocol
workspace, because the [clearing keeper](../entities/clearing-keeper.md) is the
thing they pin. **Example A** is reproduced line by line (band eligibility,
scarce-side full retention, 50/50 proration in the contested band, exact escrow
conservation), alongside conservation/balance invariants over 2,000 random books,
an order-independence check, and the lopsided-book case a naive
`min(totalYes, totalNo)` would wrongly graduate. **Example B is not separately
pinned** — the anti-manipulation result is asserted only through the general
invariants. Worth adding if the clearing math is touched again.

The TypeScript tick-math ports are likewise anchored against canonical v4-core
TickMath by a parity suite (cleanup program C6) rather than trusted by
inspection — the same dual-implementation-with-tests posture as the blessed LMSR
duplication.

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

## Observability and enforcement ([root ADR 0017](../summaries/root-adr-0017-test-observability-and-coverage-program.md), accepted 2026-07-14; A/B/D/F/G complete, C in progress, E lacks assertion tests)

The 2026-07-14 audit found the suites healthy but unobserved: lcov artifacts
uploaded and never read, coverage floors only in the app (server ~60% lines
unenforced; v4 order libraries 62–70% and only transitively tested), all
integration smokes manual-only, no flake tracking. ADR 0017 is the tracked
fix: a CI-written `ci-metrics` branch feeding sticky PR coverage-delta
comments, a trend log, README badges, and a weekly flake report (Track A —
informational only, never a required check); then enforcement along the
risk gradient — server coverage floor + route/db tests (B), a nightly
scheduled smoke tier (C, the harness skeleton for ADR 0014), dedicated
v4-library tests, a `StdInvariant` escrow-conservation harness and the
Solidity floor (D), an infra `cdk synth` gate (E), the band-pass
invariant-test timeout fix (F), and the protocol TS SDK move out of
`scripts/shared` into `protocol/src/` with its own figure and floor (G,
complete 2026-07-21: c8-`--all` lcov shipped alongside the Solidity one,
floored at the honest 36.3% baseline).
Coverage figures use workspace-own denominators (`app/src`, `server/src`,
protocol Solidity + protocol TS) with ratcheted floors for each; flake
tracking is report-only until its history justifies alerting.

## AI verdict evals ([root ADR 0019](../summaries/root-adr-0019-ai-verdict-quality-program.md), accepted 2026-07-14, review + resolution harnesses landed)

A new test kind for the two verdict services (review, resolution): an
offline eval harness at the service HTTP seams running a labeled
[failure-taxonomy](../summaries/ai-verdict-failure-taxonomy.md) dataset
(~150–200 seeds target, template-expanded) N times per case, measuring
cross-run agreement, per-class accuracy, and calibration — because
unit/smoke tiers can't catch a verdict lottery. Baselines live in-repo
like the ADR 0017 coverage metrics; a nightly/on-demand CI consistency
lane (modeled on the flake-report lane) fails on agreement or accuracy
regression beyond tolerance. Heuristic mode stays for deterministic
pipeline tests, but local stacks default to LLM providers so eval numbers
reflect what ships. **Landed (PR #226, 2026-07-15):** the review-side
runner (`server/src/ai-review/evals/run-review-evals.ts`) plus 52
hand-labeled seeds across the taxonomy classes, and the first recorded
before/after eval run (review prompt v3 adoption, 42→75% accuracy).
**Extended 2026-07-16 (PRs #236/#237/#238):** the resolution-side sibling
runner (`server/src/ai-resolution/evals/run-resolution-evals.ts`) with a
35-seed dataset (clear-YES/clear-NO controls, too_early, draw, abstain,
injection), deterministic review pre-stages plus the first in-repo eval
baseline, and the CI consistency lane — a verdict-eval regression check
wired to a dormant nightly/on-demand `verdict-evals.yml` workflow.
Template/LLM dataset expansion and the reject-corroboration policy remain
open.

## Target ([root ADR 0014](../summaries/root-adr-0014-full-lifecycle-e2e-testing.md), harness + happy path landed 2026-07-20)

One-command full-stack suite driving markets from creation to **every**
terminal state (happy + unhappy paths + infra failure drills) on the
[devchain](../entities/devchain.md); heuristic provider for determinism,
real-Anthropic smoke opt-in only; default CI stays at smoke tier. This suite
is the acceptance gate for milestones M1–M4 and the Arc launch.
**Landed 2026-07-20** (ADR 0017 item C3 first slice): the boot-once
orchestrator `pnpm local:lifecycle-nightly` plus the sequential scenario
runner and money paper-trail assertion module in
`server/src/lifecycle-nightly/`, with the happy path green end-to-end
through the real review runner, keeper clearing, and resolution runner; it
runs as the `lifecycle-scenarios` job of the Nightly Lifecycle workflow.
**All eight service/chain paths landed by 2026-07-21** (C3 complete: happy
path, rejection, manual review, failed graduation, draw/cancel, partial
clearing, and two infra drills). On top, **five Playwright `@lifecycle` UI
journeys (C4)** assert the user-visible money-out moment with an injected
wallet: the **golden journey landed 2026-07-22**
(`app/src/tests/e2e/golden-journey.spec.ts`, run by the `lifecycle:e2e` lane's
`terminal-e2e` nightly job, review via the real runner booted by `local:smoke
--with-ai-review`); rejected-creation, failed-graduation, partial-clearing,
and cancelled/draw remain.
