---
type: summary
title: ADR 0017 — Test observability and coverage program
description: Make test health visible in-repo (PR coverage deltas, trend log, badges, flake tracking) and enforce coverage along the value-transfer risk gradient; six tracks, one concern per PR.
sources:
  - docs/adr/0017-test-observability-and-coverage-program.md
updated: 2026-07-14
---

# ADR 0017 — Test observability and coverage program

**Status: Accepted (2026-07-14). Standalone tracked program (like
[ADR 0016](root-adr-0016-monorepo-architecture-cleanup-program.md)), not part
of the M1–M5 launch milestone chain. All checkboxes open at acceptance.**

A 2026-07-14 audit found the suites healthy but the feedback loops missing:
CI uploads lcov artifacts nothing reads; only the app enforces coverage
(ratcheted, 100% lines) while the server sits at ~60% lines with the route
layer, `src/db/`, and blockchain client untested and no floor; the protocol's
v4 order libraries (`PartialFillMath`, `V4DeltaSettlement`, `OrderValidation`,
62–70% lines) are covered only transitively; every integration smoke tier is
manual-only; app CI failed ~7% of recent runs with no flake tracking; `infra/`
has no CI at all.

## Decision

Two scoping rules: **in-repo tooling only** (no external coverage vendor —
rejected Codecov/Coveralls-style services over vendor/token/naming cost), and
**observability before enforcement** (Track A lands before new floors so
ratchets are set against visible numbers).

Core mechanism: an orphan **`ci-metrics` branch** (CI-written only) holding
coverage summaries, an append-only trend log, badge endpoint JSON, and the
flake report. A new `test-observability.yml` workflow triggers via
`workflow_run` on the three CI workflows: on PRs it upserts one sticky
comment (per-workspace coverage, delta vs main, Playwright retried-pass
count); on main pushes it appends the trend row and regenerates badges.
Flake signal = a rerun that passes on an unchanged head SHA, aggregated
weekly into `FLAKES.md`.

## Tracks

- **A — Coverage visibility**: the mechanism above (comment, trend, badges,
  flake report, retry surfacing).
- **B — Server floor**: bun coverage floor at the measured baseline,
  ratcheted; route-layer tests via Elysia `app.handle()`; real-SQL strategy
  (candidate PGlite) for `src/db/`.
- **C — Scheduled integration tier**: nightly run of the existing smokes
  (`local-smoke`, `local-market-smoke`, `devchain-e2e`,
  `server-ai-review-smoke`). Explicitly the harness skeleton for — not a
  replacement of — [ADR 0014](root-adr-0014-full-lifecycle-e2e-testing.md)'s
  full-lifecycle suite.
- **D — Protocol value-path coverage**: dedicated tests for the three v4
  libraries plus a `StdInvariant` escrow-conservation harness over
  `BoundedPoolOrderManager`.
- **E — Infra gate**: path-filtered `tsc` + `cdk synth` job; deployment CI
  stays with [ADR 0015](root-adr-0015-deployment-and-infrastructure.md).
- **F — Known flake fix**: explicit timeout for the band-pass clearing
  invariant test (~8s under coverage vs bun's 5s default).

## Touches

- [Testing strategy](../concepts/testing-strategy.md) — adds the
  observability/enforcement layer over the existing tiers.
- [Clearing keeper](../entities/clearing-keeper.md) — Track F fixes the
  golden-test suite's timeout margin.
