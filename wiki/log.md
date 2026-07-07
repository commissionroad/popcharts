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
