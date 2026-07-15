# Wiki operation log

Append-only, newest at the bottom. Format: see `CLAUDE.md`.

## [2026-07-07] schema | wiki bootstrapped

Pages: +CLAUDE.md, +log.md
Notes: Initial schema written; bulk ingest of all existing repo docs
(3 ADR sets, design docs, CONTEXT/CONSTITUTION files, whitepapers) in progress.

## [2026-07-07] ingest | initial bulk ingest — all repo docs + whitepapers

Pages: +51 summaries/ (all protocol/app/program ADRs, design docs, READMEs,
CONTEXT/CONSTITUTION, whitepapers v0.1/v3/v4), +14 entities/, +12 concepts/
(incl. overview.md), +index.md
Notes: Six parallel ingest agents wrote summaries; entities/concepts/index
synthesized from their reports. Whitepaper v4 formulas verified numerically
against its worked examples (PDF equations are images — text extraction
misses them). Notable findings filed on pages:

- Duplicate ADR number: two docs/adr/0007-\*.md files; the cleanup program is
  absent from docs/adr/README.md index.
- Stale docs: root README (nested lockfiles, Tenderly pointer), infra/README
  (still targets Base, pre-Arc), docs/deployment/vercel.md (sentilesdal org),
  designkit readme (PredictFun name, uploads/ paths, "CTF tokens").
- Checklist drift: cleanup-program E7 unticked though landed (PR #111);
  C1 PR number never backfilled (landed as PR #128).
- Provenance traps: pregrad/postgrad vocabulary, review stage, and the
  resolution pipeline trace to superseded whitepaper drafts, not v4;
  whitepaper_v3.pdf self-identifies as rev 0.2.
- Privy adopted without the ADR that app ADR 0005 requires.
- protocol/docs/TESTING.md predates landed clearing; verify golden tests
  exist. ADR 0015 CI checklist items look stale vs. existing CI workflows.
  Follow-ups for next lint: verify whitepaper Example A/B golden tests in the
  test suite; check app MarketStatus vs ADR 0003's frozen ladder; decide
  whether operator-auth deserves its own concept page once implemented.

## [2026-07-07] ingest | app component inventory — PriceCurve rework + outcome labels

Pages: ~summaries/app-component-inventory.md
Notes: PriceCurve became a dual-series YES/NO history chart (trailing-window
pills 1H-1M/ALL, quarter gridlines with axis values, crosshair hover);
OutcomeButton gained an optional creator outcome label. Backed by new optional
outcomeYes/outcomeNo market-metadata fields flowing creation form -> canonical
serialization -> indexer/API -> Market type.

## [2026-07-07] ingest | protocol ADR 0010 — disable the clearing challenge window by default

Pages: +summaries/protocol-adr-0010-disable-the-clearing-challenge-window-by-default.md,
~summaries/protocol-adr-0006-optimistic-offchain-graduation-clearing.md,
~concepts/graduation-clearing.md, ~entities/pregrad-manager.md, ~index.md
Notes: ADR 0010 amends 0006 — `CLEARING_CHALLENGE_PERIOD = 1 days` becomes
owner-set `clearingChallengePeriod` (default 0, max 7 days) because roots are
manager-submitted and the timeout had no dispute mechanism behind it. The
`challengeDeadline` plumbing (events, indexer, API) is kept so a real window
is a parameter change later. Same PR lands the dev graduation flow + postgrad
venue wiring the ADR unblocks.

## [2026-07-08] ingest | portfolio data design — DB-backed portfolio spec

Pages: +summaries/portfolio-data-design.md, ~entities/indexer.md,
~entities/server-workspace.md, ~entities/app-workspace.md, ~index.md
Notes: replaces the localStorage portfolio stub. Indexer page's "graduated
markets go dark" claim was stale (venue-order indexing landed 2026-07-08) and
is now superseded by the dynamic-address outcome-token Transfer watcher
(PR #151, first non-singleton watcher). Held-vs-committed distinction (order
pulls move tokens to the pool manager) is the doc's main correctness trap.
PnL deferred: Transfer indexing keeps quantities, not per-swap cost.

## [2026-07-08] ingest | portfolio data design D4 amendment — direct indexer reads

Pages: ~summaries/portfolio-data-design.md
Notes: D4's proxy route dropped in implementation; hooks read the indexer
directly (postgrad-hook precedent, base URL already NEXT_PUBLIC). Phase
status updated (2+3 landed as PR #152).

## [2026-07-09] ingest | portfolio data design — implemented (PRs #151-#154)

Pages: ~summaries/portfolio-data-design.md
Notes: all five phases landed overnight; doc status flipped to Implemented.
Receipt band column became avg price (rLow/rHigh are LMSR path bounds, not
probabilities). PnL follow-up (phase 6) remains the only open item.

## [2026-07-09] ingest | portfolio D4 fix — same-origin proxy (PR #159)

Pages: ~summaries/portfolio-data-design.md
Notes: the direct-browser-read hook (shipped #153/#154) was broken in local
dev — it read NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL, which the local stack
never sets (only the server-side POPCHARTS_INDEXER_API_URL). use-order-book.ts
uses the same-origin proxy /api/indexer/orderbook for exactly this reason.
PR #159 restores the proxy pattern for portfolio. D4 reverted to its original.

## [2026-07-09] ingest | repo ADR renumber — monorepo cleanup 0007 → 0016

Pages: +summaries/root-adr-0016-monorepo-architecture-cleanup-program.md
(renamed from root-adr-0007-...), ~summaries/root-adr-0007-track-verticals-with-progress-adrs.md,
~summaries/root-adr-index-conventions.md, ~summaries/root-adr-0006-server-runtime-and-indexer.md,
~summaries/architecture.md, ~concepts/monorepo-architecture.md, ~concepts/creation-fee-custody.md,
~entities/pregrad-manager.md, ~entities/postgrad-v4-venue.md, ~entities/postgrad-adapter.md,
~entities/creation-fee-vault.md, ~index.md
Notes: The duplicate repo ADR 0007 (monorepo cleanup program) was renumbered to
0016 in docs/adr/ and added to the README index; the canonical 0007 remains
track-verticals. Updated all wiki source-path and summary-slug references,
converted the two "numbering collision" callouts into "renumbered/resolved"
notes, and added the 0016 row to the ADR index table. No content drift beyond
the number; collision is resolved, not merely flagged.

## [2026-07-09] ingest | operator-access model correction (ADRs 0009/0011/0012/0015)

Pages: ~summaries/root-adr-0009-server-api-hardening.md,
~summaries/root-adr-0011-ai-review-service-hardening.md,
~summaries/root-adr-0012-ai-assisted-resolution.md,
~summaries/root-adr-0015-deployment-and-infrastructure.md,
~summaries/root-adr-index-conventions.md, ~concepts/ai-assisted-resolution.md,
~entities/ai-review-service.md, ~index.md
Notes: Source ADRs 0009/0011/0012 (and 0015 secrets) were corrected to a new
operator-access model: the `/admin/*` and `/dev/*` endpoints are dev-only and
must be excluded from production builds (not env-flag-gated); operator actions
(manual re-review, resolution override, key-signed transitions) are performed
locally against the chain, never through the deployed API — so there is no API
operator-auth to build. ADR 0009 also reframes the manual graduation endpoint
as the one real public write: a trigger into the server's manager-keyed
graduation process (start → off-chain band-pass clearing → Merkle root →
finalize), because on-chain startGraduation is manager-only and the sweep
cannot fit in one transaction (protocol ADR 0006). Left the ai-review design-doc
and server-README summaries unchanged — they faithfully describe their (still
unchanged) source docs, which still document the current dev/admin endpoint.

## [2026-07-09] lint | first periodic lint (window: since 2026-07-07 bootstrap)

Pages: +summaries/error-handling-ux-prd.md, ~entities/app-workspace.md,
~concepts/product-honesty-rule.md, ~index.md
Organic ingestion since bootstrap (first lint, so window = bootstrap→now):
**8/9 doc-changing PRs self-ingested.** Missed: docs/error-handling-ux-prd.md
(new design doc, added PR #150, never given a wiki page) — ingested by this
lint. Self-ingested in their own PR: protocol ADR 0006/0010 (#91),
component-inventory chart rework (#138) and pending-bar (#139),
portfolio-data-design add/reframe (#149), hook (#153), implemented (#155).
Two edge cases counted as ingested: #140's a11y component-inventory edit
reached the wiki via the next merge rather than its own PR; #129's ADR-0007
D1+D1a checkbox tick needed no wiki change (already ticked at bootstrap).
Findings:

- Staleness: none. Every page's `updated:` >= newest git date of its sources
  (checked all 82 content pages). No orphaned summaries (no source deleted).
- Integrity: clean. Zero broken internal links, zero pages missing from
  index.md, zero orphans (every content page has an inbound link or index row).
- ADR drift: root-adr-0007 cleanup-program checklist matches the live ADR
  exactly — C2/C4/C5/C6 open, D3 deferred-by-design, E7 stale-checkbox-but-
  landed, all already annotated. No drift.
- New raw source found and ingested: docs/error-handling-ux-prd.md (safe-by-
  default error presentation; the one coverage gap).
  Bootstrap follow-ups resolved:
- Whitepaper golden tests exist (protocol/test/solidity/LmsrMath.t.sol +
  nodejs/display-price-conversion.test.ts golden fixtures). Resolved.
- app MarketStatus vs ADR 0003's five-value ladder: NOT drift — the wiki
  already records the full eight-value app union (under_review/cancelled/
  rejected included) in concepts/market-lifecycle.md and the app-adr-0003
  summary. ADR 0003 is design intent; the app is deliberately ahead. Resolved.
- operator-auth concept page: still unbuilt (root ADR 0009 all-open); defer.
  Follow-ups for next lint: watch error-handling PRD open questions (logging
  vendor, API error codes) for a resolving ADR; re-check whether app MarketStatus
  grows further past ADR 0003.

## [2026-07-13] lint | first periodic lint reconcile — 2 missed design docs + checklist drift across 6 vertical ADRs

Pages: +summaries/ai-resolution-service-design.md,
+summaries/clearing-keeper-design.md, ~concepts/ai-assisted-resolution.md,
~entities/clearing-keeper.md, ~concepts/graduation-clearing.md,
~concepts/deployment-and-infrastructure.md, ~overview.md,
~summaries/root-adr-0008-protocol-functionality-completion.md,
~summaries/root-adr-0009-server-api-hardening.md,
~summaries/root-adr-0010-indexer-maturity.md,
~summaries/root-adr-0011-ai-review-service-hardening.md,
~summaries/root-adr-0013-app-feature-completion.md,
~summaries/root-adr-0015-deployment-and-infrastructure.md, ~index.md;
date-only bumps (content already reconciled, `updated:` never touched by the
07-09 renumber/operator-access ingests): ~summaries/architecture.md,
~concepts/{creation-fee-custody,monorepo-architecture,local-dev-orchestration,market-lifecycle}.md,
~entities/{creation-fee-vault,postgrad-adapter,pregrad-manager,protocol-workspace,server-workspace,indexer,app-workspace}.md.

Organic ingestion since last lint (window 2026-07-09 post-PR#156 → 2026-07-13,
5 doc-change units): **2/5 self-ingested.** Self-ingested in their own PR: the
0007→0016 renumber (#170, 13 wiki files) and the operator-access correction
(#171, 9 wiki files). Missed: (a) `docs/ai-resolution-service-design.md` — the
ADR 0012 service/runner design (#165/#166), no wiki page; (b)
`docs/clearing-keeper-design.md` — the ADR 0008 clearing design (#172), no wiki
page; (c) commit 7335233 "Reconcile vertical ADR checklists against a code
audit" — re-ticked 0008/0009/0010/0011/0013/0015 with 0 wiki files touched. The
07-09 design sprint shipped design docs and checkbox reconciles without the
per-session ingest.

Findings and fixes:

- **New docs ingested:** two summary pages created and cross-linked into the AI
  resolution concept, clearing-keeper entity, and graduation-clearing concept.
  ai-resolution adds the per-outcome temporal gates (`yes_not_before` new
  on-chain param, `no_not_before` = `resolution_time`), `too_early` outcome +
  on-chain floor guard, 0.85/24h safety valves, draws-always-manual, and
  self-resolve in the first build — superseding the concept's old single-
  `resolutionTime` framing. clearing-keeper documents the band-pass sweep,
  largest-remainder rounding (whitepaper open question 3), snapshotHash
  verification, and the "root is unbound at submit" trap.
- **Checklist drift (real content):** 6 vertical-ADR summaries had `[ ]` boxes
  the 07-09 code-audit reconcile flipped to `[x]`. Reconciled tick-state,
  headings, descriptions, and index annotations. Hidden-drift catch: 0009/0011
  summaries were already dated 2026-07-09 (bumped by the _later_ operator-access
  ingest) yet still carried unticked boxes from the _earlier_ same-day reconcile
  — a date-based scan alone would have missed them.
- **Status drift:** clearing keeper and AI resolution were labelled "not
  built/unbuilt" in the keeper entity, graduation-clearing concept, and
  overview; both now have accepted designs and landing implementations (PRs
  #172/#176 keeper sweep; resolution runner on-chain transition/config/client).
  Flagged that ADR 0012's doc checklist still reads all-open while its code has
  begun landing — code ahead of the checklist, not silently re-ticked (raw docs
  are never edited by the wiki).
- **Integrity:** 0 broken internal links; 0 orphans (both new pages linked from
  index + a concept/entity); staleness clean after fixes. `whitepaper_v3.pdf`
  and `app-adr-readme.md` were scan false-positives (multi-line frontmatter /
  `app/docs` substring), not real gaps.
- **Note for the human:** PR #156 ("Wiki lint 2026-07-09") is still OPEN and
  unmerged; it ingests `docs/error-handling-ux-prd.md` (not touched here to
  avoid duplication). This PR is additive and branched from origin/main, so both
  append log.md and index.md — merge #156 first, or take-both on the trivial
  conflict.

Follow-ups for next lint: once ADR 0012 items are ticked in the doc, reconcile
the resolution concept/summary build-status claims against the code; re-verify
Server CI checkbox (ADR 0015) against `.github/workflows/`; carry the whitepaper
Example A/B golden-test check forward (now referenced by the new clearing-keeper
design summary — confirm the fixture landed).

## [2026-07-14] lint | new protocol ADR 0011 ingested; ADR 0008 + 0016 checklist drift; AI review default flipped to Ollama

Pages: +summaries/protocol-adr-0011-admin-market-cancellation.md,
~summaries/root-adr-0008-protocol-functionality-completion.md,
~summaries/root-adr-0016-monorepo-architecture-cleanup-program.md,
~summaries/portfolio-data-design.md, ~summaries/server-readme.md,
~summaries/root-readme.md, ~summaries/root-adr-0015-deployment-and-infrastructure.md,
~summaries/error-handling-ux-prd.md, ~entities/pregrad-manager.md,
~entities/clearing-keeper.md, ~entities/postgrad-v4-venue.md,
~entities/ai-review-service.md, ~entities/indexer.md, ~entities/devchain.md,
~entities/server-workspace.md, ~concepts/market-lifecycle.md,
~concepts/graduation-clearing.md, ~concepts/monorepo-architecture.md,
~concepts/testing-strategy.md, ~index.md.

Organic ingestion since last lint (window 2026-07-13 post-#182 → 2026-07-14,
5 prose doc-change units): **0/5 self-ingested.** Missed: (a)
`protocol/docs/adr/0011-admin-market-cancellation.md` — brand-new ADR, no wiki
page (#186); (b) `docs/adr/0016` — four Track-C ticks (#132/#184/#190 + C6) and
a status flip to "fully executed"; (c) `docs/adr/0008` — three clearing ticks
plus the auto-refund/poll-based note (#177); (d) `docs/portfolio-data-design.md`
— the new money-paper-trail invariant (also promoted into `AGENTS.md`); (e)
`server/README.md` + `README.md` — AI review default flipped to Ollama (#183).
Every one of these shipped with zero wiki files touched. (Screenshot-only
changes under `app/docs/screenshots/` are excluded from the count — binary
assets with no prose to summarize.) The per-session ingest rule in `AGENTS.md`
is not being followed by feature sessions; two lints running, two dry spells.

Findings and fixes:

- **New source ingested:** protocol ADR 0011, the owner-only `cancelMarket`
  moderation kill switch. Before it, a live market holding real escrow had no
  way to be stopped — `rejectMarket` only works pre-escrow, `markRefundable`
  only at the deadline, and `MarketStatus.Cancelled` was an enum value no
  function ever assigned while the portfolio already rendered `cancelled` as
  `refund_claimable` (a projection with no on-chain path behind it). The refund
  path is _reused_, not duplicated: the claim guard widens to "Refunded or
  Cancelled", so double-refund safety is inherited rather than re-argued.
- **Doc/code drift flagged, not fixed:** ADR 0011 still reads _Proposed_ while
  its code is on `main` (contract, event, widened guard, `market_cancelled_events`
  - watcher). Noted on the page; the wiki never edits raw sources.
- **Checklist drift (real content), the same hidden-drift class the last lint
  warned about:** ADR 0008 went 4/10 → 7/10 (whole clearing block) and ADR 0016
  went to fully-executed, both on 2026-07-13 — the _same date_ the last lint
  stamped its pages, so a date-based staleness scan reports them clean. Only a
  tick-count diff against the raw ADRs catches it. Reconciled both, plus the
  downstream keeper/venue/architecture pages that called this work "open".
- **Two caveats the ticks hide, now recorded loudly:** the clearing keeper is
  **poll-based**, not a `GraduationStarted` watcher, and the automated keeper
  (auto-refund included) is **gated to the local network** — elsewhere no-match
  refunds still depend on permissionless `markRefundable`. "Ticked" ≠ "runs
  unattended in production".
- **AI review default is now Ollama, not heuristic.** The security-relevant part
  is the asymmetric fallback: locally `AI_REVIEW_FALLBACK_APPROVE=true` lets a
  clean market auto-approve when the model is down, but that flag is off
  everywhere else (an `approve` downgrades to `manual_review`), and hard-flag
  rejects are always final. The fallback can lose an approval, never a rejection.
- **Integrity:** 2 broken links fixed in `summaries/error-handling-ux-prd.md`
  (pointed at `root-adr-0007-monorepo-architecture-cleanup-program.md`, dead
  since the 0007→0016 renumber; PR #156 was written pre-renumber and merged
  after it). 0 orphans, 0 pages missing from index, no dangling sources.
- **Carried-forward follow-ups, both resolved:** (1) _Server CI checkbox (ADR 0015)_ — **not** stale-unticked. `server-ci.yml` exists and runs
  format/lint/typecheck/`openapi:check`/`test:coverage`, but has **no Postgres
  service container**, which is precisely what the item asks for; the open box is
  honest and the real gap is narrower than "no Server CI". (2) _Whitepaper
  golden-test fixture_ — it landed, but not where `protocol/docs/TESTING.md`
  implies: it is in `server/src/keeper/clearing/band-pass-clearing.test.ts` (the
  keeper is what it pins), with **Example A** reproduced line by line plus
  invariants over 2,000 random books. **Example B is not separately pinned.**
- **Also corrected:** the indexer watches **eleven** PregradManager events, not
  nine (`MarketCancelled` + the two receipt-claim events); `ai-review-service.md`
  still called resolution "unbuilt" (its design is accepted and landing).
- **ADR 0012 remains 0/10 ticked** — no reconcile needed; the concept pages'
  "design accepted, build underway" framing still matches.

Follow-ups for next lint: watch whether ADR 0011's status flips from Proposed
now that its code has landed; check whether the clearing keeper gets ungated
beyond the local network (that would change several status claims); consider
whether whitepaper Example B deserves its own golden test if the clearing math is
touched again; ADR 0012 tick-state vs the resolution code that is landing.

## [2026-07-14] ingest | repo ADR 0016 — D3 settlement-handler split executed (trigger fired)

Pages: ~summaries/root-adr-0016-monorepo-architecture-cleanup-program.md, ~concepts/monorepo-architecture.md, ~index.md
Notes: The D3 item's documented split trigger fired — `server/src/indexer/handlers/settlement.ts` gained a 7th event type (MarketCancelled, commit c2e9768, the protocol ADR 0011 kill switch) — so the standing deferred-by-design guard converted to executed work: checkbox ticked, Progress Log row added, split performed as three sibling handler modules (graduation/refunds/claims) plus private shared plumbing behind a kept `settlement.ts` barrel. "Two intentional unticked boxes" framing across the summary and the monorepo-architecture concept page reduced to E7 only.

## [2026-07-14] ingest | repo ADR 0017 — test observability and coverage program

Pages: +summaries/root-adr-0017-test-observability-and-coverage-program.md, ~concepts/testing-strategy.md, ~index.md
Notes: New standalone tracked program (ADR 0016 model) from the 2026-07-14
testing-infra audit. Six tracks: A coverage visibility (ci-metrics branch,
sticky PR coverage-delta comment, trend, badges, weekly flake report), B
server coverage floor + route/db tests, C nightly scheduled smoke tier
(harness skeleton for ADR 0014, scope stays with 0014), D v4 order-library
tests + StdInvariant escrow harness, E infra cdk-synth gate (deployment CI
stays with ADR 0015), F band-pass invariant-test timeout fix. Watch for:
ADR 0015's stale CI checkboxes ("Server CI workflow" unchecked though the
workflow exists) — flagged during the audit, not fixed in this ingest.

## [2026-07-14] ingest | AI review pending lifecycle and score rationales

Pages: ~summaries/root-readme.md, ~summaries/server-readme.md, ~summaries/ai-review-runner-design.md, ~summaries/root-adr-0011-ai-review-service-hardening.md, ~entities/ai-review-service.md, ~index.md
Notes: Provider latency no longer becomes a completed local heuristic approval. The durable runner keeps transient failures pending with bounded five/six/ten-minute model/request/lease limits; public reads expose pending/complete/attention states, the detail page refreshes active work, and completed reviews persist a rationale for every score.

## [2026-07-14] ingest | repo ADR 0017 — grill-session amendments (same-day)
Pages: ~summaries/root-adr-0017-test-observability-and-coverage-program.md, ~concepts/testing-strategy.md, ~entities/protocol-workspace.md, ~index.md
Notes: Grill session on Track A produced four new scoping rules
(informational-only reporting — never a required check; workspace-own
coverage denominators with protocol split into Solidity + TS figures;
ratcheted floors for every workspace; flake tracking report-only with a
2026-07-28 revisit) and a new Track G: move the TS SDK modules out of
protocol/scripts/shared/{price,market} into protocol/src with a
src-must-not-import-scripts lint guard. Notable audit fact folded in:
consumers were already clean (server imports only the bare specifier; the
exports map is the allowlist) — the boundary hole was the package's own
barrel. Track A ships with protocol = Solidity figure only; the TS figure
is a Track G exit criterion.

## [2026-07-14] ingest | repo ADR 0017 — Track A completed (flake report + retry surfacing)
Pages: ~summaries/root-adr-0017-test-observability-and-coverage-program.md, ~index.md
Notes: Final two Track A boxes ticked: weekly FLAKES.md job (schedule +
workflow_dispatch on test-observability.yml; report-only, >5% threshold
computed but never alerting) and Playwright retried-pass surfacing in the PR
comment (app CI now uploads app-e2e-report; comment payload gained an
optional e2e field, version unchanged). First real-data run: App CI 7.5%
failure rate over 7 days but zero rerun-passes — no one reruns failures at
the same SHA yet, so the flake column starts empty. Also corrected this
summary's stale "scripts/ci/" location claim to the actual scripts/ci-*.ts +
scripts/shared/ layout.

## [2026-07-14] ingest | repo ADR 0017 — Track B grill decisions, Track C scope broadened
Pages: ~summaries/root-adr-0017-test-observability-and-coverage-program.md
Notes: Second grill session (Track B). Two-substrate decision: PGlite for
unit (spike-gated), real Postgres service container for integration+ —
per-PR inside Check server for DB-only tests (*.int.test.ts convention),
nightly for anything needing a chain or second service. Paper-trail
invariant chosen as the first integration cargo over route breadth. Track C
renamed "nightly full-fidelity tier" and broadened from scheduling existing
smokes to growing new full-stack scenarios. Floor measured on unit tier
only.

## [2026-07-14] ingest | repo ADR 0017 — Track F completed (invariant-test timeout)
Pages: ~summaries/root-adr-0017-test-observability-and-coverage-program.md, ~index.md
Notes: The band-pass invariant test (2000 random books) got a 30s explicit
timeout against bun's 5s default — it ran ~8s under coverage
instrumentation locally while CI stayed green, i.e. a latent local-only
flake. Done as its own micro-PR ahead of Track B item 1 because the floor
work needs clean local coverage runs to measure baselines.

## [2026-07-14] ingest | repo ADR 0017 — Track B item 1 landed (server coverage floor)
Pages: ~summaries/root-adr-0017-test-observability-and-coverage-program.md
Notes: bunfig gained ../protocol/** in coveragePathIgnorePatterns (bun's own
totals now workspace-own: functions 70.09 / lines 74.88 — note bun's line
metric differs from the lcov-derived badge figure, two rulers by design) and
coverageThreshold { function = 0.70, line = 0.74 }. Bun gotcha recorded in
bunfig comment: threshold keys are singular; plural keys OR an unmet
threshold both exit 1 with zero diagnostic output. Enforcement verified in
both directions locally.

## [2026-07-14] ingest | repo ADR 0017 — Track B item 2 landed (PGlite spike: go)
Pages: ~summaries/root-adr-0017-test-observability-and-coverage-program.md
Notes: receipt-placed.pglite.test.ts proves the unit substrate: PGlite +
drizzle-orm/pglite + drizzle-kit/api pushSchema under bun test, no Docker.
Covers replay dedup via the real unique index, raw-SQL increments, and
rollback when the markets projection is missing. Coverage rose to 74.52
funcs / 75.31 lines (bun metrics) and the floor ratcheted up with it —
first ratchet bump of the program. Executor typing still needs the cast
noted in-file; first-class injection is Track B item 4.

## [2026-07-14] ingest | repo ADR 0017 — Track B item 3 landed (paper-trail integration suite)
Pages: ~summaries/root-adr-0017-test-observability-and-coverage-program.md
Notes: Check server gained a postgres:16-alpine service container and a
per-PR integration step; *.int.test.ts convention is describe.skipIf on
POPCHARTS_INT_DB_URL with throwaway databases (int-db.ts; drizzle-kit
generateMigration DDL because pushSchema is incompatible with the
postgres-js driver). paper-trail.int.test.ts covers all 7 persist
functions: exactly-once replay, receipt/market linkage, rollback on
missing market. Found, not fixed: claim persistence requires the market
row but not the referenced receipt row (task chip filed). Unit suite and
coverage floor untouched by all this — int tests skip without the env.

## [2026-07-14] ingest | repo ADR 0017 — Track B complete (items 4+5: injectable db, route tests, boundary doc)
Pages: ~summaries/root-adr-0017-test-observability-and-coverage-program.md, ~index.md
Notes: src/db/client.ts `db` is now a lazy Proxy (function-binding get,
setDbForTesting override; no connection until first query, so route tests
inject PGlite before anything connects). app.handle() route tests cover
system/markets/portfolio with exact-serialization assertions; portfolio
asserts the chain-unreachable degraded shape. Test-substrate boundary rule
documented in server/src/test-support/README.md. Floor ratcheted to
function 0.7672 / line 0.7666. Whole Track B checklist closed same-day as
the grill that designed it.

## [2026-07-14] ingest | go-live: landing + app deployed, domains attached (PR #221)
Pages: +summaries/deployment-go-live-dns.md, ~summaries/deployment-vercel.md,
~concepts/deployment-and-infrastructure.md, ~index.md
Notes: docs/deployment/vercel.md now points at commissionroad/popcharts and
the popcharts-app project (stale-org note resolved); new
docs/deployment/go-live-dns.md is the go-live state ledger — landing
(popcharts-landing) and app (popcharts-app) live on Vercel, popcharts.xyz
and app.popcharts.xyz attached, Namecheap nameserver delegation pending.
Concept page no longer says "nothing is deployed": frontend live, backend
and protocol remain M5. The no-env app deploy labels fixture markets with a
sample-data banner (product honesty rule).

## [2026-07-14] ingest | portfolio-data-design — postgrad_redemption_events added to paper-trail tables
Pages: ~summaries/portfolio-data-design.md
Notes: The claim-winnings build (resolution redemption UI) added the
postgrad_redemption_events table indexing Redeemed/CancelledRedeemed from
graduated CompleteSetBinaryMarkets — the first concrete realization of the
invariant's "resolution redemption" clause. Doc bullet and summary updated;
index line unchanged (already mentions the invariant).
