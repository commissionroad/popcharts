# ADR 0017: Test Observability and Coverage Program

Status: Accepted

Date: 2026-07-14

## Context

A 2026-07-14 audit of the testing infrastructure found the test suites
themselves healthy but their feedback loops missing:

- All three CI workflows (app, protocol, server) run tests with coverage on
  every PR and push to main, and upload `lcov.info` artifacts — which nothing
  consumes. They expire unread after 14 days. There is no PR coverage
  comment, no diff against main, no trend, no badges, and no flake tracking.
- Only the app enforces coverage (ratcheted Vitest thresholds, 100% lines).
  Server sits at ~60% lines of `server/src` with the HTTP route layer,
  `src/db/` (19 files), and `src/blockchain/client.ts` at zero coverage, and
  no floor — coverage could halve and nothing would notice. Protocol is at
  ~92% lines overall, but the v4 order libraries that move value
  (`PartialFillMath` 62%, `V4DeltaSettlement` 66%, `OrderValidation` 70%)
  are covered only transitively through `BoundedPoolOrderManager.t.sol`,
  with no dedicated tests and no stateful invariant suites.
- Every integration tier that exercises the real stack (`local-smoke`,
  `local-market-smoke`, `devchain-e2e`, `server-ai-review-smoke`) is
  manual-only. The full-lifecycle suite is ADR 0014's scope and remains open.
- App CI failed ~7% of completed runs over the last five days; nothing
  distinguishes real breakage from flakes. One latent flake is already
  known: the band-pass clearing invariant test (2,000 random books) runs
  ~8s under coverage instrumentation against bun's 5s default timeout.
- `infra/` (CDK) has no tests and no CI workflow; a broken stack definition
  is discovered at deploy time.

## Decision

Run a tracked program to make test health visible and enforce it where it
protects value transfer, following the ADR 0016 model: one concern per PR,
checklist updated in the same PR as the work.

Two scoping decisions:

- **In-repo tooling only.** No external coverage vendor (Codecov,
  Coveralls). The mechanisms below are a few small workflow jobs and a
  metrics branch; an external service adds a vendor dependency, upload
  tokens, and third-party naming into workflows for no capability we need.
- **Observability first, then floors.** Visibility (Track A) lands before
  new enforcement (Tracks B, D) so ratchets are set against numbers everyone
  can see.

### Mechanism: the `ci-metrics` branch

An orphan branch `ci-metrics` is the datastore for everything below —
per-workspace coverage summaries (JSON), an append-only trend log (JSONL,
one row per main push), badge endpoint JSON files, and the flake report.
Nothing on it is hand-edited; only CI commits to it. This keeps metrics
history out of main's history while staying fully in-repo and reviewable.

A new workflow (`test-observability.yml`) triggers via `workflow_run` on
the three CI workflows:

- **PR completions:** download that run's coverage artifact, compare
  per-workspace lines/branches against the main baseline read from
  `ci-metrics`, and upsert a single sticky PR comment (marker-based) with a
  table: workspace, lines %, delta vs main, plus Playwright
  flaked-on-retry count when the app smoke ran. Workspaces skipped by path
  filters are omitted.
- **Main-push completions:** append the trend row, regenerate badge JSON
  and `TRENDS.md`, and push to `ci-metrics`.

README gets per-workspace coverage badges served from the badge JSON on
`ci-metrics` (the repo is public, so a standard badge endpoint works).

Flake tracking is two-sided:

- A weekly scheduled job aggregates workflow-run outcomes (failure rate,
  pass-on-rerun rate per workflow — a rerun that passes on an unchanged
  head SHA is the flake signal) into `FLAKES.md` on `ci-metrics`.
- The Playwright JSON report's retry data feeds the PR comment, so an e2e
  spec that only passed on retry is visible at review time.

### Tracks

**Track A — Coverage visibility (the mechanism above).**

- [ ] `ci-metrics` orphan branch seeded with current baselines
- [ ] `test-observability.yml`: PR sticky comment with per-workspace
      coverage and delta vs main
- [ ] Main-push trend log + `TRENDS.md` on `ci-metrics`
- [ ] README coverage badges (app / protocol / server)
- [ ] Weekly flake report (`FLAKES.md`): failure rate and pass-on-rerun
      rate per workflow
- [ ] Playwright retry data surfaced in the PR comment

**Track B — Server coverage floor and the untested layers.**

- [ ] Set a bun coverage floor at the current measured baseline; ratchet
      upward as coverage lands (mirroring the app's ratchet convention)
- [ ] Route-layer tests via `app.handle()` against the Elysia apps (no
      listening server), covering `src/api/routes/`
- [ ] A real-SQL strategy for `src/db/` (candidate: PGlite) replacing
      hand-rolled fake executors where the SQL itself is the risk
- [ ] Decide and document what stays fake-executor tested vs real-SQL
      tested

**Track C — Scheduled integration tier.**

- [ ] Nightly workflow: docker-compose Postgres + devchain, then
      `local-smoke`, `local-market-smoke`, `devchain-e2e`,
      `server-ai-review-smoke`
- [ ] Failures append to the flake report and notify (issue or existing
      channel)

This track only schedules the smokes that already exist. The full-lifecycle
suite (every terminal state, unhappy paths) remains ADR 0014's scope; this
nightly job is its natural harness skeleton.

**Track D — Protocol value-path coverage.**

- [ ] Dedicated unit tests for `PartialFillMath`, `V4DeltaSettlement`,
      `OrderValidation`
- [ ] A `StdInvariant` harness over `BoundedPoolOrderManager` asserting
      escrow conservation across randomized order/fill/cancel sequences

**Track E — Infra check gate.**

- [ ] Path-filtered CI job for `infra/**`: `tsc --noEmit` + `cdk synth`
- [ ] CDK assertion tests as a follow-up once the gate exists

Deployment CI (image builds, deploy pipelines) stays with ADR 0015; this
track adds only a correctness gate.

**Track F — Known flake fixes.**

- [ ] Explicit timeout (or reduced default book count with the full run
      behind an env flag) for the band-pass clearing invariant test

### Exit criteria

- A PR touching any tested workspace shows its coverage delta without the
  author doing anything.
- Coverage trend and flake rate for main are readable in-repo at any time.
- Server and protocol coverage cannot silently regress (floors in place).
- The v4 order libraries have dedicated tests and an escrow-conservation
  invariant suite.
- `infra/` cannot merge in a state that fails `cdk synth`.

## Consequences

Positive:

- Coverage regressions and flakes become visible at review time instead of
  never.
- Enforcement follows the risk gradient: the strictest gates move from UI
  code toward the code that moves money.
- No new vendors, tokens, or external dashboards.

Tradeoffs:

- `workflow_run`-based reporting is more moving parts than a vendor
  integration; badge/trend plumbing is ours to maintain.
- The `ci-metrics` branch is unusual repo furniture; contributors must know
  not to touch it (documented in its README).
- Weekly flake stats from workflow outcomes are coarse; per-test flake
  attribution only exists where the runner reports retries (Playwright).
