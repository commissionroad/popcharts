---
type: entity
title: AI review service and runner
description: Stateless moderation/knowability HTTP service with pluggable providers (ollama by default locally, heuristic fallback, anthropic) plus a DB-leasing runner that gates market entry — working end to end locally.
sources:
  - docs/ai-review-runner-design.md
  - docs/ai-review-next-phase.md
  - docs/adr/0011-ai-review-service-hardening.md
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
  + optional context in → verdict out. No DB polling or projection writes.
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
limits), `anthropic` (Messages API with native web_search/web_fetch, capped
by `AI_REVIEW_ANTHROPIC_MAX_WEB_*`). `AI_REVIEW_INTERNET_ACCESS=off|provided_urls`
restricts evidence. Response parsing (verdict/score clamping) is a single
shared module — a deliberate security control (cleanup program B1).

**Local default is `ollama`, not `heuristic`** (changed 2026-07-13): `just
local-dev` now starts the real agent-based path. The fallback semantics are the
security-relevant part, and they are asymmetric by design:

- If the Ollama runtime is not running, reviews degrade to the deterministic
  heuristic.
- **Locally only**, the orchestrator sets `AI_REVIEW_FALLBACK_APPROVE=true` so a
  clean market still auto-approves instead of parking in `manual_review` and
  blocking test flows.
- That flag is **off by default everywhere else**, so production never
  auto-approves when the model is unavailable — an `approve` downgrades to
  `manual_review`.
- Hard-flag rejects from the heuristic gate are always final, in every mode: the
  fallback can lose an approval, never a rejection.

Security posture: deterministic hard-blocks before model/web access; all
market text and fetched content treated as untrusted (prompt-injection
refusal rules); per-request provider failure degrades to `manual_review`,
never silent approval.

## Status

Working end to end locally (`just server-ai-review-smoke`, service on
127.0.0.1:3002). All hardening open per
[root ADR 0011](../summaries/root-adr-0011-ai-review-service-hardening.md):
safe-web hardening, strict output validation,
`AI_REVIEW_PROMPT_VERSION` policy, stuck-job recovery, metrics. (Manual
re-review is a local operator action, not an API endpoint.)

## Related pages

- [Market lifecycle](../concepts/market-lifecycle.md) — the gate it operates
- [Server workspace](server-workspace.md), [indexer](indexer.md)
