---
type: entity
title: AI review service and runner
description: Stateless moderation/knowability HTTP service with pluggable providers plus a DB-leasing runner that keeps transient local-model failures pending and gates market entry — working end to end locally.
sources:
  - docs/adr/0022-review-first-market-creation.md
  - docs/ai-review-runner-design.md
  - docs/ai-review-next-phase.md
  - docs/adr/0011-ai-review-service-hardening.md
  - docs/adr/0019-ai-verdict-quality-program.md
  - server/README.md
updated: 2026-08-06
---

# AI review service and runner

Reviews market **drafts** (moderation + public-knowability) before any market
exists on chain. This gates market **creation** — distinct from
post-graduation [AI-assisted resolution](../concepts/ai-assisted-resolution.md),
whose design is accepted and whose build is underway as a sibling of this
architecture.

## Two-process architecture

- **Service** (`server/src/ai-review/`, port 3002) — stateless HTTP: metadata
  - optional context in → verdict out. No DB polling or projection writes.
- **Runner** (`server/src/draft-review/runner.ts`) — **not a separate
  process**: the API server starts it in-process (`src/api/index.ts`). It
  claims draft-review jobs via `FOR UPDATE SKIP LOCKED` with leases, calls the
  service, and records the verdict on the draft. Polling is intentional, for
  recoverability.

The indexer no longer participates. It used to write `under_review`
projections for the runner to resolve; ADR 0022 P5 removed that status, so
indexed markets are born `Active`.

> **Source drift (2026-08-06).** This page has been corrected against the code,
> but its source
> [`docs/ai-review-runner-design.md`](../../docs/ai-review-runner-design.md)
> still documents the retired three-process, on-chain-gated design. Fix that
> source, then re-ingest this page.

## Providers

One service, pluggable providers: `heuristic` (deterministic, smoke and
hard-blocks), `ollama` (local model; service pre-collects evidence with
SSRF-style guards — private-IP/localhost blocks, size/redirect/content-type
limits), `anthropic` (Messages API with native web*search/web_fetch, capped
by `AI_REVIEW_ANTHROPIC_MAX_WEB*\*`). `AI_REVIEW_INTERNET_ACCESS=off|provided_urls`
restricts evidence. Response parsing (verdict/score clamping) is a single
shared module — a deliberate security control (cleanup program B1).

**Default provider is `codex-cli`** (changed 2026-07-29; `claude-cli` from
2026-07-25, `ollama` before that): `just local-dev` starts the real
agent-based path. Local provider latency now follows
the durable queue rather than becoming a review result:

- The model has a five-minute local budget; runner request and DB lease limits
  are longer.
- Transient provider failures remain retryable jobs, with no immutable review
  row, scorecard, or auto-approval.
- Public market reads report `pending`, `complete`, or `attention_required`;
  the detail page refreshes while pending.
- Every completed score stores a concise rationale beside the number.
- Hard-flag rejects from the heuristic gate are always final, in every mode: the
  pending path can delay approval, never weaken a rejection.

Security posture: deterministic hard-blocks before model/web access; all
market text and fetched content treated as untrusted (prompt-injection
refusal rules); per-request provider failure degrades to `manual_review`,
never silent approval.

## Status

Working end to end locally (`just server-ai-review-smoke`, service on
127.0.0.1:3002). Remaining hardening is tracked in
[root ADR 0011](../summaries/root-adr-0011-ai-review-service-hardening.md):
safe-web hardening, strict output validation,
`AI_REVIEW_PROMPT_VERSION` policy, stuck-job recovery, metrics. (Manual
re-review is a local operator action, not an API endpoint.)

**Verdict quality is a separate program, now started**
([root ADR 0019](../summaries/root-adr-0019-ai-verdict-quality-program.md),
accepted 2026-07-14): the 2026-07-14 test session found verdicts a
run-to-run lottery (identical markets drawing reject vs manual_review) and
one false REJECT away from irreversibly burning a market. Landed (PR #226,
2026-07-15): the offline eval harness at the service HTTP seam
(`server/src/ai-review/evals/`), a 52-seed labeled
[failure-taxonomy](../summaries/ai-verdict-failure-taxonomy.md) dataset,
and review prompt v3 (`market-ai-review-v3`) adopted with before/after
eval numbers — the first exercise of the measure-before-tuning rule.
Extended 2026-07-16 (PRs #238/#237): deterministic pre-stages promoted into
`heuristics.ts` (with few-shot anchors), the first in-repo eval baseline,
and a CI consistency lane — a verdict-eval regression check wired to a
dormant on-demand workflow that fails on agreement/accuracy regression.
Still planned: a **reject-corroboration policy** (on-chain reject only with
hard-flag agreement or second-run concurrence; lone LLM rejects park as
manual_review) and the `AI_REVIEW_PROMPT_VERSION` eval policy that closes
the 0011 checkbox.

## Draft review (ADR 0022, built 2026-08-03)

[Repo ADR 0022](../summaries/root-adr-0022-review-first-market-creation.md)
relocates review **off-chain, onto Drafts, before any market exists**. The original
runner and its tables (`market_ai_reviews`/`market_ai_review_jobs`) are
on-chain-market-bound (`marketId NOT NULL`, FKs to `markets`/`market_metadata`), so
this needed **new draft-keyed tables + a second runner** applying verdicts as
draft-state transitions with no on-chain `approveMarket`/`rejectMarket`. The reused
part is the *pattern* (content-addressed metadata keyed to the draft's snapshot
hash, the leased-job queue, the stateless service), not the tables.

This is built: `market_draft_reviews` / `market_draft_review_jobs`, the draft-review
runner started from the API main block (heuristic provider by default,
`POPCHARTS_DRAFT_REVIEW_PROVIDER` overrides), and a creator-facing feedback
translator turning hard flags and scores into per-field
`{title, issue, howToFix, severity}`. Verdicts land as
`approved | rejected | changes_requested` — the third state, absent from the original
design, carries *quality* feedback (from a `manual_review` verdict) as distinct from
a *policy* rejection.

**Where a published market's review comes from (decided 2026-08-05).** P5 left
`market_ai_reviews` with no writer while the market detail page still read from it, so
markets created after P5 rendered no review at all. Resolved by **join, not copy**: a
published market finds its review through the publish bookkeeping on `market_drafts`,
narrowed to the draft's submitted snapshot and taken newest-first. Copying draft reviews
into a market-scoped row was rejected as a second source of truth for one fact. The join
is exact — publish refuses unless the draft is unchanged since review and verifies the
on-chain `metadataHash`, so the reviewed snapshot is provably the live market's metadata.
`market_ai_reviews` is now read-only history with a live reader: legacy rows still win
where they exist, because for a pre-P5 market that row *is* the review that gated it.

`market_ai_review_jobs` is gone entirely: the admin re-review service that
enqueued into it was retired first (nothing had claimed the queue since P5
deleted the market-review runner), then the table itself was dropped with
`market_ai_reviews`.

**The on-chain review path is retired**, completing ADR 0022 P5. Publish now
spends a creator-bound authorization signed with
`POPCHARTS_MARKET_CREATION_AUTHORIZER_PRIVATE_KEY`, and markets are born
`Active` — there is no `approveMarket`/`rejectMarket` bridge and no
review-manager key left to force-approve with.

## Related pages

- [Market lifecycle](../concepts/market-lifecycle.md) — the gate it operates
- [Repo ADR 0022](../summaries/root-adr-0022-review-first-market-creation.md) — review moved off-chain onto drafts (built); its P5 retired the on-chain path
- [Server workspace](server-workspace.md), [indexer](indexer.md)
