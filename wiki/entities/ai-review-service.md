---
type: entity
title: AI review service and draft review loop
description: Moderation/knowability review with pluggable providers, run as a leased-queue loop inside the API over off-chain drafts — no separate runner process, no chain key; the standalone HTTP service survives only as an eval and local surface.
sources:
  - docs/adr/0022-review-first-market-creation.md
  - docs/ai-review-runner-design.md
  - docs/backend-runtime-architecture.md
  - docs/ai-review-next-phase.md
  - docs/adr/0011-ai-review-service-hardening.md
  - docs/adr/0019-ai-verdict-quality-program.md
  - server/README.md
updated: 2026-08-06
---

# AI review service and draft review loop

Reviews market questions (moderation + public-knowability) **as off-chain
drafts, before any market exists**. This gates market **creation** — distinct
from post-graduation
[AI-assisted resolution](../concepts/ai-assisted-resolution.md), which remains a
separate service + runner pair and is the sibling this lane no longer mirrors.

## Architecture (as of 2026-08-06)

The 2026-08-05 staleness banner here is resolved: `docs/ai-review-runner-design.md`
and `docs/backend-runtime-architecture.md` were rewritten against the code, so
this page now describes the shipped shape rather than flagging a contradiction.
The three-process design it used to carry is history, kept in
[the superseded design summary](../summaries/ai-review-runner-design.md).

There is **no separate review runner process**. Review is one loop inside the
API:

- **Producer** — the API. A creator submits a draft; the same transaction moves
  it to `in_review` and inserts one `market_draft_review_jobs` row. A draft never
  touches the chain, so the indexer plays no part.
- **Loop** — `startDraftReviewRunner()` in `server/src/draft-review/runner.ts`,
  started by `server/src/api/index.ts:44` when the API runs as the main module.
  It polls once a second, claims up to three due jobs under a five-minute lease
  via `FOR UPDATE SKIP LOCKED`, and writes one `market_draft_reviews` row keyed
  to the submitted snapshot hash, so a late verdict cannot apply to edited text.
  Completion is fenced on the runner still holding its lease, which is why
  running in every autoscaled API replica is safe. It holds no chain key.
- **Verdict** — a draft transition, never a market one: `approve`→`approved`,
  `reject`→`rejected`, everything else→`changes_requested`. Failures retry with
  exponential backoff from 15s capped at 5min; after the last attempt the draft
  returns to `editing` with no review row, so a silent failure never reaches the
  creator as feedback.
- **Model call** — in process (`reviewMarket()`), not over HTTP. The stateless
  service (`server/src/ai-review/`, port 3002) still exists as a build target and
  a local process, but nothing in the live path calls it: no server code reads
  `AI_REVIEW_SERVICE_URL`, its only HTTP caller is the ADR 0019 eval harness, and
  it has no container in the CDK stack.

Gone with ADR 0022 P5, and absent from `server/src`: `market_ai_review_jobs`,
`market_ai_reviews` as a write target, `approveMarket`/`rejectMarket`, any
`/admin` route, `POPCHARTS_ADMIN_REVIEW_ENABLED` as a code-read flag, and any
read of `POPCHARTS_REVIEW_MANAGER_PRIVATE_KEY`.

## Providers

One service, pluggable providers: `heuristic` (deterministic, smoke and
hard-blocks), `ollama` (local model; service pre-collects evidence with
SSRF-style guards — private-IP/localhost blocks, size/redirect/content-type
limits), `anthropic` (Messages API with native web*search/web_fetch, capped
by `AI_REVIEW_ANTHROPIC_MAX_WEB*\*`). `AI_REVIEW_INTERNET_ACCESS=off|provided_urls`
restricts evidence. Response parsing (verdict/score clamping) is a single
shared module — a deliberate security control (cleanup program B1).

**Default provider is `anthropic` over pre-collected evidence**
(`AI_REVIEW_EVIDENCE_MODE=precollected`, `AI_REVIEW_SEARCH_PROVIDER=tavily`;
verified against `server/src/ai-review/config.ts` on 2026-08-05, and previously
`codex-cli` from 2026-07-29, `claude-cli` from 2026-07-25, `ollama` before
that). That path needs `ANTHROPIC_API_KEY` and `TAVILY_API_KEY`. The local stack
overrides all three — `claude-cli`, `native`, `duckduckgo` — in
`scripts/shared/aiReview/buildAiReviewEnv.ts`, so `just local-dev` starts the
real agent-based path with no API key. Local provider latency follows
the durable queue rather than becoming a review result:

- The model has a five-minute local budget; the draft review job lease is also
  five minutes.
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

Working end to end locally. `just local-dev` runs the draft review path inside
the API; `just local-ai-review` starts Postgres plus the standalone review
service on 127.0.0.1:3002 with no API, so it runs no draft review loop. (The
`just server-ai-review-smoke` recipe this page used to cite no longer exists in
the justfile.) Remaining hardening is tracked in
[root ADR 0011](../summaries/root-adr-0011-ai-review-service-hardening.md):
safe-web hardening, strict output validation, `AI_REVIEW_PROMPT_VERSION` policy,
stuck-job recovery, metrics. There is no operator re-review trigger at all —
re-review is creator-driven, by resubmitting a draft that is `editing`,
`changes_requested`, or `rejected`.

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
this needed **new draft-keyed tables and a new loop** applying verdicts as
draft-state transitions with no on-chain `approveMarket`/`rejectMarket`. The reused
part is the *pattern* — content-addressed metadata keyed to the draft's snapshot
hash, and the leased-job queue — not the tables, and not the process shape: the
new loop runs inside the API and calls the reviewer in process rather than
calling the stateless service over HTTP.

This is built: `market_draft_reviews` / `market_draft_review_jobs`, the draft-review
loop started from the API main block (heuristic provider by default,
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
`market_ai_reviews` was **dropped**, not kept — migration
`0038_romantic_starhawk.sql` drops it and `market_ai_review_jobs` together, and
`getLatestMarketReviews` (`server/src/api/services/markets.ts`) queries only the
draft-review side. ADR 0022 and two comments in `markets.ts` still describe it as
read-only history whose legacy rows "win where they exist"; that was true when
written and stopped being true at 0038. The join above is the only review reader.

`market_ai_review_jobs` likewise has neither a writer nor a claimer, and
its Drizzle table is gone. Only the shared review enums survive, relocated into
`server/src/db/schema/market-draft-reviews.ts:23-27`, whose comment records the
move. (An earlier version of this page said an admin re-review service still
enqueued into it. There is no `/admin` route in `server/src`, and nothing
enqueues into that table.)

**The on-chain review path is gone.** P4 and P5 both landed on 2026-08-04: the
ungated `createMarket`, the force-approve bridge, and the review-manager key
went with them. `approveMarket` and `rejectMarket` appear nowhere in
`server/src`, and `POPCHARTS_REVIEW_MANAGER_PRIVATE_KEY` is gone entirely — read
by no code, and removed from `server/sample.env` on 2026-08-06 along with
`POPCHARTS_ADMIN_REVIEW_ENABLED`.

## Related pages

- [Market lifecycle](../concepts/market-lifecycle.md) — the gate it operates
- [Repo ADR 0022](../summaries/root-adr-0022-review-first-market-creation.md) — review moved off-chain onto drafts (built); the on-chain path retires with its P5
- [Server workspace](server-workspace.md), [indexer](indexer.md)
