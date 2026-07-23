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

Scoping decisions (the last four from the 2026-07-14 grill session):

- **In-repo tooling only.** No external coverage vendor (Codecov,
  Coveralls). The mechanisms below are a few small workflow jobs and a
  metrics branch; an external service adds a vendor dependency, upload
  tokens, and third-party naming into workflows for no capability we need.
- **Observability first, then floors.** Visibility (Track A) lands before
  new enforcement (Tracks B, D) so ratchets are set against numbers everyone
  can see.
- **Informational, not gating.** The observability workflow never blocks a
  merge and is not a required check. Enforcement lives inside each
  workspace's existing required CI job as a ratcheted floor, where it fails
  fast and reproduces locally. A `workflow_run`-based gate would duplicate
  that with worse ergonomics, and a flaky reporter must never be able to
  block merges.
- **Workspace-own denominators.** A reported coverage figure counts only
  the workspace's own sources: `app/src/**`, `server/src/**`, and protocol
  as two figures — Solidity contracts, and protocol TS (`protocol/src/**`,
  excluding `generated/`). Files a suite exercises from another workspace
  (e.g. protocol helpers imported by server tests, ~10 points of swing in
  the server number) are attributed to their home workspace only. This is
  what makes a delta mean something about *this* PR and keeps floors
  honest.
- **Every workspace gets a floor**, set at its measured baseline and
  ratcheted upward as coverage lands: app (exists today), server (Track B),
  protocol Solidity (Track D), protocol TS (Track G).

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
  table: workspace, lines %, delta vs main (with the baseline commit SHA),
  plus Playwright flaked-on-retry count when the app smoke ran. Workspaces
  skipped by path filters are omitted — which also makes baseline staleness
  a non-issue: a workspace's baseline only lags on pushes the path filter
  asserts didn't touch that workspace's coverage inputs.

Security posture: the reporting workflow runs with write permissions on the
base repo, so it treats PR artifacts strictly as data — it never checks out
or executes PR code. Reporting logic lives as typed scripts under
`scripts/ci/` with seam tests, gated by the existing `scripts:check`.
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

Flake tracking ships **report-only**: no auto-issue filing until the report
has enough history to prove an alert threshold meaningful (candidate: flake
rate >5% over 7 days; revisit scheduled for 2026-07-28).

### Tracks

**Track A — Coverage visibility (the mechanism above).**

- [x] `ci-metrics` orphan branch seeded with current baselines
- [x] `test-observability.yml`: PR sticky comment with per-workspace
      coverage and delta vs main
- [x] Main-push trend log + `TRENDS.md` on `ci-metrics`
- [x] README coverage badges (app / protocol / server)
- [x] Weekly flake report (`FLAKES.md`): failure rate and pass-on-rerun
      rate per workflow
- [x] Playwright retry data surfaced in the PR comment

Track A ships with the protocol figure covering Solidity contracts only
(what hardhat's coverage emits today); the protocol TS figure plugs in as a
Track G exit criterion. The plumbing is generic — it reports whatever
summaries `ci-metrics` holds.

**Track B — Server coverage floor and the untested layers.**

Substrate decision (2026-07-14 grill): two tiers, not one. Unit tests use
in-process PGlite (real Postgres-dialect SQL, zero setup, no Docker) so
DB-real unit coverage stays fast and expansive; everything above unit —
integration, e2e, smoke — uses a real Postgres. DB-boundary integration
tests run **per PR** inside the `Check server` job via a `services:
postgres` container; they are colocated as `*.int.test.ts`, excluded from
the unit run, and must stay deterministic since they gate merges. The
placement rule for future tests: needs only Postgres → per-PR integration;
needs a chain or a second service → nightly (Track C). The boundary rule
for test style: real-SQL tests for code whose risk is the SQL (the db
layer, persistence with conflict/transaction semantics — the money paper
trail); fake executors stay for pure projection/serialization logic. The
coverage floor is measured on the unit tier only.

Sequenced checklist (one PR each):

- [x] Floor first: align bun's own denominator with the workspace-own
      definition (`coveragePathIgnorePatterns` for `../protocol`) and set
      `coverageThreshold` at the measured baseline; ratchet upward
      manually as coverage lands (app convention — never-regress, no
      mandated target)
- [x] PGlite spike: one persistence-function test file against
      drizzle-orm's PGlite adapter under `bun test`; go/no-go for the
      unit substrate (fallback: the service container everywhere)
- [x] Money paper-trail integration suite as the container's first cargo:
      drive the settlement/refunds/claims handler family twice with the
      same event against real Postgres and assert exactly-once
      persistence, receipt linkage, and that the
      `ensure-local-unique-constraints` DDL holds — converting the
      paper-trail invariant (docs/portfolio-data-design.md) from prose
      into a merge gate
- [x] Make the `src/db/client.ts` import-time singleton injectable, then
      route-layer tests via `app.handle()` against the Elysia apps (no
      listening server), covering `src/api/routes/`
- [x] Document the fake-executor vs real-SQL boundary where the test
      helpers live

**Track C — Nightly full-fidelity tier.**

Design settled by the 2026-07-15 grill. Two separate nightly suites, so a
slow or red AI lane never masks a lifecycle regression:

- **`nightly-lifecycle`** — the market-lifecycle regression net. Drives
  every lifecycle path (creation good/bad, pregrad trading, pregrad
  cancel/refund, graduation, partial clearing refunds, postgrad trading,
  resolution, draw/cancel redemption) through the **service/chain layer**:
  scripts against the devchain, real API + indexer + heuristic AI
  services, devchain time-jumps for the lifecycle clocks, and assertions
  on API responses and the database — every path ends by asserting the
  money paper trail balances. The scenario checklist itself lives in ADR
  0014 (this track is its delivery vehicle; 0014 boxes tick in the same
  PRs). On top, **five full-E2E UI journeys** (Playwright `@lifecycle`
  tag, injected wallet — no auth-vendor login in nightly): the golden
  journey to redeemed winnings, rejected creation, failed-graduation
  refund, partial-clearing claims, and cancelled/draw redemption — every
  terminal state crossed with the user-visible money-out moment.
- **`nightly-ai-verdicts`** — the AI review + resolution consistency lane
  at the service HTTP seams, no UI. Specified by ADR 0019 (labeled
  dataset, consistency measurement); this track only provides the
  scheduled harness and executes 0019's CI-lane checkbox.

Failure handling: each suite auto-files/refreshes its own tracking issue
(closed with a comment on the next green run) and appends to the flake
report. Rationale: a nightly red is actionable binary breakage, unlike the
statistical flake alerting deliberately deferred in Track A. Revisit
(noted 2026-07-15): move notifications to a project Discord once one
exists. Cron ~09:00 UTC plus `workflow_dispatch`.

Placement note (corrected 2026-07-15 during C1 pre-flight): the grill
assumed `server-ai-review-smoke` needs only Postgres and should move
per-PR. Verification falsified that — the review runner submits a real
on-chain approval transition (wallet client against PregradManager), so
the smoke needs a chain and stays nightly, riding the lifecycle job's
deployed stack via the stack-generated `server/.env.local-chain`.

- [x] C1 — `nightly-lifecycle` workflow running the three chain smokes
      (`local-smoke`, `local-market-smoke`, `devchain-e2e`) with the
      tracking-issue lifecycle and flake-report append
- [x] C2 — repair `server-ai-review-smoke` and add it to the nightly
      lifecycle job. Found broken on main during C1 pre-flight: it
      fabricates a synthetic market in the database, but the review
      runner now submits a real on-chain approval transition and reverts
      with `MarketDoesNotExist`. The repair seeds its market on-chain
      (and rules out per-PR placement for good — it needs a chain)
- [x] C3 — lifecycle harness (boot once, heuristic providers, time-jump
      utilities) + service/chain scenarios, tracked scenario-by-scenario
      in ADR 0014's checklist. All eight service/chain paths land
      (`server/src/lifecycle-nightly/`): happy path, rejection, manual
      review, failed graduation, draw/cancel, partial clearing, and two
      infrastructure drills (indexer restart, AI-service outage). The
      drills bounce supervised services through a stack control server the
      orchestrator exposes (`scripts/shared/process/stackControl.ts`), so a
      scenario expresses intent without owning process lifecycles. The five
      `@lifecycle` UI journeys remain C4.
- [x] C4 — the five `@lifecycle` UI journeys (also ticked in ADR 0014).
      Golden, rejected creation, failed graduation, partial clearing, and
      cancelled/draw, all through the injected wallet, with review verdicts
      forced deterministically through a dev endpoint (review is a controlled
      test input, not an AI dependency). They run in the
      `lifecycle:e2e` lane's nightly job (`pnpm lifecycle:e2e`); the golden
      journey and the two refund/redeem journeys assert the user-visible
      money-out moment, and partial clearing itemizes retained + refunded on
      `/portfolio`.
- [ ] C5 — `nightly-ai-verdicts` workflow (executes ADR 0019's CI lane)
- [ ] C6 — morning visibility: nightly outcomes summarized in `TRENDS.md`
      alongside coverage (the operator-side heads-up agent is personal
      tooling, outside the repo)

**Track D — Protocol value-path coverage.**

- [x] Dedicated unit tests for `PartialFillMath`, `V4DeltaSettlement`,
      `OrderValidation`
- [x] A `StdInvariant` harness over `BoundedPoolOrderManager` asserting
      escrow conservation across randomized order/fill/cancel sequences
- [x] Protocol Solidity coverage floor at the measured baseline (~92%
      lines), ratcheted

**Track E — Infra check gate.**

- [x] Path-filtered CI job for `infra/**`: `tsc --noEmit` + `cdk synth`
- [ ] CDK assertion tests as a follow-up once the gate exists

Deployment CI (image builds, deploy pipelines) stays with ADR 0015; this
track adds only a correctness gate.

**Track F — Known flake fixes.**

- [x] Explicit timeout (or reduced default book count with the full run
      behind an env flag) for the band-pass clearing invariant test

**Track G — Protocol TS SDK surface.**

Added after the 2026-07-14 grill session. The protocol package's public
barrel (`protocol/src/index.ts`) re-exports ~25 symbols from
`protocol/scripts/shared/{price,market}` — the TS SDK's implementation
partially lives in the scripts tree, next to deploy/ops tooling. Consumers
are already clean (server imports only the bare `@popcharts/protocol`
specifier; app uses only declared subpath exports, enforced by the
`exports` allowlist), but the boundary hole is inside the package: a
`scripts/shared` change silently alters the shipped app bundle and server
behavior, and those modules' coverage is attributed to no enforced figure.

- [x] Move the pure-TS SDK modules from `protocol/scripts/shared/{price,market}`
      into `protocol/src/` (e.g. `src/price/`, `src/market/`); `scripts/`
      imports from `src/`, never the reverse. The closure came to 29 files:
      the barreled price/market modules plus their transitive deps
      (`src/viem/` ERC20/receipt wrappers, `src/cli/requireCliValue`,
      `src/json/jsonFile`, reached via `readCompleteSetMarketManifest`)
- [x] Import-lint guard: `protocol/src/**` must not import from
      `protocol/scripts/**` (`test/nodejs/sdk-surface-guard.test.ts`; also
      pins the exports-map targets to `src/` and the subpath key set)
- [x] `exports` map unchanged as the consumer allowlist (two targets
      retargeted from `scripts/shared/price/` to `src/price/`; no key
      renamed, added, or removed)
- [x] Protocol TS coverage figure (`protocol/src/**`, excluding
      `generated/`) added to the PR comment, trend, and badges, with a
      floor at the measured baseline (36.3%; measured 36.37% — c8 `--all`
      over the nodejs suite, so SDK modules no test loads count as 0%,
      which is the honest denominator this track exists to expose. The
      low starting floor is the point: it can only ratchet up)

### Exit criteria

- A PR touching any tested workspace shows its coverage delta without the
  author doing anything.
- Coverage trend and flake rate for main are readable in-repo at any time.
- No workspace's coverage can silently regress: ratcheted floors exist for
  app, server, protocol Solidity, and protocol TS, each over its own
  sources only.
- The v4 order libraries have dedicated tests and an escrow-conservation
  invariant suite.
- The protocol package's public TS surface lives entirely under
  `protocol/src/`, with the src→scripts import direction lint-enforced.
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
