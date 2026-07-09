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
