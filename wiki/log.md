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
- Duplicate ADR number: two docs/adr/0007-*.md files; the cleanup program is
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
  summaries were already dated 2026-07-09 (bumped by the *later* operator-access
  ingest) yet still carried unticked boxes from the *earlier* same-day reconcile
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
