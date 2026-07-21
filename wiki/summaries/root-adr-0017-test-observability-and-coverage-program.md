---
type: summary
title: ADR 0017 — Test observability and coverage program
description: Make test health visible in-repo (informational-only PR coverage deltas, trend log, badges, report-only flake tracking) and ratchet per-workspace coverage floors over workspace-own denominators; seven tracks incl. the protocol TS SDK move, one concern per PR.
sources:
  - docs/adr/0017-test-observability-and-coverage-program.md
updated: 2026-07-21
---

# ADR 0017 — Test observability and coverage program

**Status: Accepted (2026-07-14). Standalone tracked program (like
[ADR 0016](root-adr-0016-monorepo-architecture-cleanup-program.md)), not part
of the M1–M5 launch milestone chain. Track A completed 2026-07-14 (PR #208
core pipeline; the flake report and Playwright retry surfacing followed the
same day); Track F (invariant-test timeout) and Track B (server floor +
untested layers, five items) completed 2026-07-14; Track D (v4 value-path
coverage) completed 2026-07-15; Tracks C/E/G open.**

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
  only — **landed 2026-07-14**, function 70%/line 74% in bun's own
  metrics), PGlite spike (**landed 2026-07-14 — go**: PGlite + drizzle +
  drizzle-kit pushSchema all work under bun test, in-process, ~2s; the spike
  verifies unique-index replay dedup, raw-SQL counter increments, and
  transaction rollback on `persistReceiptPlacedRecord` — exactly the claims
  fake executors cannot falsify), then the **money paper-trail integration suite** as
  the container's first cargo (**landed 2026-07-14**: all seven
  settlement/claims/refunds persist functions replay-tested against a
  real Postgres per PR — `services: postgres` in Check server, throwaway
  database per file via `server/src/test-support/int-db.ts`,
  `*.int.test.ts` self-skip without POPCHARTS_INT_DB_URL; found-not-fixed:
  claim handlers don't require the referenced receipt row to exist), then `db` singleton
  injectability + `app.handle()` route tests (**landed 2026-07-14**: lazy
  proxy in client.ts + setDbForTesting; route tests for system/markets/
  portfolio run on PGlite in the unit tier; boundary documented in
  `server/src/test-support/README.md`). Fake executors stay for pure
  projection/serialization logic. **Track B complete 2026-07-14** — floor
  ratcheted twice on the way (70.09→74.52→76.73 functions).
- **C — Nightly full-fidelity tier** (design settled by the 2026-07-15
  grill; items C1–C6 open): **two separate nightly suites** so a slow/red
  AI lane never masks a lifecycle regression. `nightly-lifecycle` = the
  three chain smokes plus the full market-lifecycle regression net at the
  service/chain layer (heuristic providers, devchain time-jumps, every
  path ends asserting the money paper trail), delivered as
  [ADR 0014](root-adr-0014-full-lifecycle-e2e-testing.md)'s checklist —
  Track C is 0014's delivery vehicle, not a competitor — plus five
  full-E2E Playwright `@lifecycle` UI journeys (golden path to redeemed
  winnings, rejected creation, failed-graduation refund, partial-clearing
  claims, cancelled/draw redemption via the ADR 0018 surface).
  `nightly-ai-verdicts` = the service-seam consistency lane specified by
  [ADR 0019](root-adr-0019-ai-verdict-quality-program.md) (C5 executes its
  CI-lane box). Failures auto-file/refresh one tracking issue per suite +
  append to FLAKES.md (binary breakage ≠ the deferred statistical flake
  alerting); revisit: Discord notifications once set up.
  `server-ai-review-smoke` stays nightly (grill premise corrected same
  day: the runner submits a real on-chain approval transition — needs a
  chain) and was found broken on main during pre-flight (fabricated
  market → MarketDoesNotExist); C2 is now its repair + nightly wiring.
- **D — Protocol value-path coverage** (**complete 2026-07-15**): dedicated
  harness-backed suites for the three v4 libraries (boundary + fuzz), a
  `StdInvariant` escrow-conservation harness over `BoundedPoolOrderManager`
  (handler-driven create/cancel/swap/resolve; invariants: non-custodial
  components hold zero, live book entries backed 1:1 by pool positions,
  value only moves between actors and the pool — Hardhat 3 runs invariant_
  functions natively), and a Solidity line floor enforced by
  `scripts/ci-check-coverage-floor.ts` in protocol CI (96.67, measured
  96.68 after the new suites — up from 92.1).
- **E — Infra gate** (gate **landed 2026-07-15**; CDK assertion tests
  remain a follow-up): path-filtered `Check infra` job — `tsc --noEmit` +
  credential-less `cdk synth` (verified to need no AWS account), same
  self-gating paths-filter pattern as the other three CIs, added to the
  required status checks; deployment CI stays with
  [ADR 0015](root-adr-0015-deployment-and-infrastructure.md).
- **F — Known flake fix** (**complete 2026-07-14**): explicit timeout for the band-pass clearing
  invariant test (~8s under coverage vs bun's 5s default).
- **G — Protocol TS SDK surface** (added post-grill; **complete
  2026-07-21**): the package barrel re-exported ~25 symbols from
  `protocol/scripts/shared/{price,market}`, so the TS SDK partially lived
  in the scripts tree. Consumers were already clean (server imports only
  the bare specifier; app only declared subpath exports; the `exports`
  map is the allowlist). Executed: the 29-file closure (price, market,
  and transitive viem/cli/json deps) moved into
  `protocol/src/{price,market,viem,cli,json}/`, scripts now import from
  src (never the reverse), and `test/nodejs/sdk-surface-guard.test.ts`
  enforces the direction plus pins the exports-map targets and key set.
  The fourth coverage figure — Protocol (TS), `src/**` minus `generated/`
  via c8 `--all` over the nodejs suite so never-loaded SDK modules count
  as 0% — ships in the same `protocol-coverage` artifact (`lcov-ts.info`),
  joins the PR comment/trend/badges, and is floored at its measured
  36.3% baseline (deliberately low: the honest number, ratchet-up only).

## Touches

- [Testing strategy](../concepts/testing-strategy.md) — adds the
  observability/enforcement layer over the existing tiers.
- [Clearing keeper](../entities/clearing-keeper.md) — Track F fixes the
  golden-test suite's timeout margin.
- [protocol/ workspace](../entities/protocol-workspace.md) — Track G
  reshapes its package export surface.
