---
type: summary
title: ADR 0017 — Test observability and coverage program
description: Make test health visible in-repo (informational-only PR coverage deltas, trend log, badges, report-only flake tracking) and ratchet per-workspace coverage floors over workspace-own denominators; seven tracks incl. the protocol TS SDK move, one concern per PR.
sources:
  - docs/adr/0017-test-observability-and-coverage-program.md
updated: 2026-07-14
---

# ADR 0017 — Test observability and coverage program

**Status: Accepted (2026-07-14). Standalone tracked program (like
[ADR 0016](root-adr-0016-monorepo-architecture-cleanup-program.md)), not part
of the M1–M5 launch milestone chain. Track A completed 2026-07-14 (PR #208
core pipeline; the flake report and Playwright retry surfacing followed the
same day); Tracks B–G open.**

A 2026-07-14 audit found the suites healthy but the feedback loops missing:
CI uploads lcov artifacts nothing reads; only the app enforces coverage
(ratcheted, 100% lines) while the server sits at ~60% lines with the route
layer, `src/db/`, and blockchain client untested and no floor; the protocol's
v4 order libraries (`PartialFillMath`, `V4DeltaSettlement`, `OrderValidation`,
62–70% lines) are covered only transitively; every integration smoke tier is
manual-only; app CI failed ~7% of recent runs with no flake tracking; `infra/`
has no CI at all.

## Decision

Scoping rules (the last four added by the 2026-07-14 grill session):
**in-repo tooling only** (no external coverage vendor — rejected
Codecov/Coveralls-style services over vendor/token/naming cost);
**observability before enforcement** (Track A lands before new floors so
ratchets are set against visible numbers); **informational, not gating**
(the observability workflow is never a required check — enforcement lives
inside each workspace's existing required CI job as ratcheted floors);
**workspace-own denominators** (`app/src/**`, `server/src/**`, protocol
split into Solidity and TS figures; cross-workspace imports attributed to
their home workspace — worth ~10 points in the server number); **every
workspace gets a ratcheted floor** (app exists; server Track B; protocol
Solidity Track D; protocol TS Track G).

Core mechanism: an orphan **`ci-metrics` branch** (CI-written only) holding
coverage summaries, an append-only trend log, badge endpoint JSON, and the
flake report. A new `test-observability.yml` workflow triggers via
`workflow_run` on the three CI workflows: on PRs it upserts one sticky
comment (per-workspace coverage, delta vs main, Playwright retried-pass
count); on main pushes it appends the trend row and regenerates badges.
Flake signal = a rerun that passes on an unchanged head SHA, aggregated
weekly into `FLAKES.md` — report-only for now; auto-issue filing deferred
until the history proves a threshold meaningful (revisit 2026-07-28). The
reporting workflow treats PR artifacts strictly as data (never executes PR
code); its logic is typed entry scripts at `scripts/ci-*.ts` over pure
modules in `scripts/shared/{coverage-report,flake-report}/`, gated by the
seam tests in `scripts/test/` (protocol CI's `scripts:check`).

## Tracks

- **A — Coverage visibility** (**complete 2026-07-14**): the mechanism
  above (comment, trend, badges, flake report, retry surfacing). Ships with
  the protocol figure covering Solidity contracts only; the protocol TS
  figure is a Track G exit criterion.
- **B — Server floor and untested layers** (design grilled 2026-07-14):
  two-substrate rule — unit tests on in-process PGlite (pending a go/no-go
  spike), everything above unit on real Postgres. DB-boundary integration
  tests (`*.int.test.ts`, excluded from the unit run) gate merges per-PR
  via a `services: postgres` container in `Check server`; placement rule:
  needs only Postgres → per-PR, needs a chain/second service → nightly
  (Track C). Sequenced: floor first (bun `coveragePathIgnorePatterns` +
  `coverageThreshold` at baseline, manual never-regress ratchet, unit tier
  only), PGlite spike, then the **money paper-trail integration suite** as
  the container's first cargo (replay each settlement/refund/claim event
  twice, assert exactly-once receipt-linked persistence — the
  portfolio-data-design invariant as a merge gate), then `db` singleton
  injectability + `app.handle()` route tests. Fake executors stay for pure
  projection/serialization logic.
- **C — Nightly full-fidelity tier** (scope broadened by the grill): the
  nightly run of the existing smokes (`local-smoke`, `local-market-smoke`,
  `devchain-e2e`, `server-ai-review-smoke`) plus deliberate growth of new
  full-stack scenarios (graduation clearing on a seeded book, refund path,
  postgrad handoff). Explicitly the harness skeleton for — not a
  replacement of — [ADR 0014](root-adr-0014-full-lifecycle-e2e-testing.md)'s
  full-lifecycle suite.
- **D — Protocol value-path coverage**: dedicated tests for the three v4
  libraries plus a `StdInvariant` escrow-conservation harness over
  `BoundedPoolOrderManager`.
- **E — Infra gate**: path-filtered `tsc` + `cdk synth` job; deployment CI
  stays with [ADR 0015](root-adr-0015-deployment-and-infrastructure.md).
- **D also carries** the protocol Solidity floor (~92% lines baseline).
- **F — Known flake fix**: explicit timeout for the band-pass clearing
  invariant test (~8s under coverage vs bun's 5s default).
- **G — Protocol TS SDK surface** (added post-grill): the package barrel
  re-exports ~25 symbols from `protocol/scripts/shared/{price,market}`, so
  the TS SDK partially lives in the scripts tree. Consumers are already
  clean (server imports only the bare specifier; app only declared subpath
  exports; the `exports` map is the allowlist). Fix: move those modules
  into `protocol/src/` (`src/price/`, `src/market/`), scripts import from
  src (never the reverse, lint-guarded), and the protocol TS coverage
  figure + floor comes with it.

## Touches

- [Testing strategy](../concepts/testing-strategy.md) — adds the
  observability/enforcement layer over the existing tiers.
- [Clearing keeper](../entities/clearing-keeper.md) — Track F fixes the
  golden-test suite's timeout margin.
- [protocol/ workspace](../entities/protocol-workspace.md) — Track G
  reshapes its package export surface.
