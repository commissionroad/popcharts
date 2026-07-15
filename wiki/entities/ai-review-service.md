---
type: entity
title: AI review service and runner
description: Stateless moderation/knowability HTTP service with pluggable providers plus a DB-leasing runner that keeps transient local-model failures pending and gates market entry — working end to end locally.
sources:
  - docs/ai-review-runner-design.md
  - docs/ai-review-next-phase.md
  - docs/adr/0011-ai-review-service-hardening.md
  - docs/adr/0019-ai-verdict-quality-program.md
  - server/README.md
updated: 2026-07-14
---

# AI review service and runner

Reviews newly created markets (moderation + public-knowability) before they
open for trading. This gates market **creation** — distinct from
post-graduation [AI-assisted resolution](../concepts/ai-assisted-resolution.md),
whose design is accepted and whose build is underway as a sibling of this
architecture.

## Three-process architecture

- **Indexer** writes `under_review` projections; no model/web access ever.
- **Service** (`server/src/ai-review/`, port 3002) — stateless HTTP: metadata
  - optional context in → verdict out. No DB polling or projection writes.
- **Runner** (`server/src/ai-review-runner/`) — polls/claims
  `market_ai_review_jobs` via `FOR UPDATE SKIP LOCKED` with leases, calls the
  service, persists append-only `market_ai_reviews` (keyed to metadata_hash so
  reviews can't silently apply to changed text), then applies guarded
  transitions: approve→`bootstrap`, reject→`rejected`, manual_review→unchanged
  — submitting on-chain `approveMarket`/`rejectMarket` first (signs with
  `POPCHARTS_REVIEW_MANAGER_PRIVATE_KEY`), exponential backoff. Polling is
  intentional, for recoverability.

## Providers

One service, pluggable providers: `heuristic` (deterministic, smoke and
hard-blocks), `ollama` (local model; service pre-collects evidence with
SSRF-style guards — private-IP/localhost blocks, size/redirect/content-type
limits), `anthropic` (Messages API with native web*search/web_fetch, capped
by `AI_REVIEW_ANTHROPIC_MAX_WEB*\*`). `AI_REVIEW_INTERNET_ACCESS=off|provided_urls`
restricts evidence. Response parsing (verdict/score clamping) is a single
shared module — a deliberate security control (cleanup program B1).

**Local default is `ollama`, not `heuristic`** (changed 2026-07-13): `just
local-dev` starts the real agent-based path. Local provider latency now follows
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

**Verdict quality is a separate, unstarted program**
([root ADR 0019](../summaries/root-adr-0019-ai-verdict-quality-program.md),
accepted 2026-07-14): the 2026-07-14 test session found verdicts a
run-to-run lottery (identical markets drawing reject vs manual_review) and
one false REJECT away from irreversibly burning a market. Planned: an
offline eval harness at the service HTTP seam
(`server/src/ai-review/evals/`), a labeled failure-taxonomy dataset,
deterministic pre-stages promoted out of the model, a
**reject-corroboration policy** (on-chain reject only with hard-flag
agreement or second-run concurrence; lone LLM rejects park as
manual_review), a CI consistency lane, and the `AI_REVIEW_PROMPT_VERSION`
eval policy that closes the 0011 checkbox.

## Related pages

- [Market lifecycle](../concepts/market-lifecycle.md) — the gate it operates
- [Server workspace](server-workspace.md), [indexer](indexer.md)
