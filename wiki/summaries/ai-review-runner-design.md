---
type: summary
title: AI Review Runner Design (docs/ai-review-runner-design.md)
description: Design for the DB-polling review runner that bridges under_review market projections to the stateless AI Review service via a durable job table with leasing, retries, and guarded status transitions.
sources:
  - docs/ai-review-runner-design.md
updated: 2026-07-14
---

# AI Review Runner Design

Dated 2026-06-23. Status per the doc: runner foundation, manual enqueue, and
local smoke are **implemented**. It designs the bridge between persisted
markets and the stateless [AI Review service](../entities/ai-review-service.md)
— a separate AI Review runner process in `server/`
(`server/src/ai-review-runner/index.ts`), distinct from both the
[indexer](../entities/indexer.md) and the review HTTP service even though all
share the `server` package and database schema.

## Decision and division of labor

- **Indexer**: watches chain, writes event and market projections
  (`MarketCreated` → `under_review`); never calls models or review policy.
- **AI Review service**: stateless HTTP; one review request in, one
  moderation + public-knowability result out; never polls or mutates the DB.
- **Runner**: polls and claims durable jobs from PostgreSQL, calls the
  service (`POST /reviews/market`), persists immutable attempts into the
  append-only `market_ai_reviews` table, applies narrow guarded market status
  transitions, retries transport failures with backoff, and serves manual
  re-review requests through the same path.

Goals: chain ingestion independent of model latency/provider failures; the
service stays stateless; missed/stuck/manual reviews recoverable from DB
state; audit trail of attempts; duplicate runners safe via database leasing.
Non-goals: no prompts/provider logic in the runner, no admin UI, no AWS
deployment in this slice, don't use `bypassAiResolution` as a review-skip
flag (semantics unconfirmed), and keep the existing on-chain
`MarketReviewApproved`/`MarketReviewRejected` watcher.

## Data model

A durable `market_ai_review_jobs` table with statuses (`queued`, `running`,
`succeeded`, `retryable_failed`, `terminal_failed`, `cancelled`) and triggers
(`automatic`, `manual`, `retry`). Key columns: job keys
`(chain_id, market_id, metadata_hash)` (the hash prevents stale reviews
applying to changed metadata), optional `requested_provider`/
`requested_model` overrides, `priority`, `attempt_count`/`max_attempts`,
`run_after` (backoff), `lease_until`/`locked_by` (multi-runner safety),
compact `last_error`, and nullable `review_id` FK to the final
`market_ai_reviews` row. A partial unique index forbids duplicate active jobs
per `(chain_id, market_id, metadata_hash)` while status is queued/running/
retryable_failed. Composite FKs tie jobs back to `markets` and
`market_metadata`.

## Behavior

- **Eligibility** (automatic): market is `under_review`, metadata row exists,
  no active job, and no successful review for the exact metadata hash (manual
  `force: true` overrides the last rule). Later freshness rules may re-review
  on prompt/provider/policy changes.
- **Claiming**: `SELECT ... FOR UPDATE SKIP LOCKED` on
  queued/retryable_failed jobs whose `run_after` has passed and lease
  expired, ordered by priority; claimed rows become `running` with a lease.
- **Execution**: missing rows → `terminal_failed`; market no longer
  `under_review` → `cancelled`; valid response → persist review, set
  `review_id`, `succeeded`, guarded status transition; transport/non-2xx →
  `retryable_failed` with exponential backoff, `terminal_failed` after the
  ceiling. Transient provider failures are non-2xx service responses, so they
  never create immutable review rows or heuristic scorecards. A valid
  `manual_review` verdict remains a successful result — the runner never parses
  reason prose to decide retries. The stock local budget is five minutes for
  model work, six minutes for the runner request, and ten minutes for the lease.
- **Status transitions** (guarded by `status = 'under_review'` and metadata
  hash): `approve` → `bootstrap`; `reject` → `rejected`; `manual_review` →
  stays `under_review`. Zero-row updates still count as job success (the
  attempt persisted) with a log that the market had already moved. Chain
  review events and runner decisions remain two valid inputs to the same
  projection; the guards keep them from overwriting each other. See
  [market lifecycle](../concepts/market-lifecycle.md).
- **Manual trigger**: `POST /admin/markets/:chainId/:marketId/review` on the
  server API (not the review service), enqueueing a `manual` job; disabled by
  default behind `POPCHARTS_ADMIN_REVIEW_ENABLED=true`, with real operator
  auth expected before production exposure. `force` semantics: return the
  existing active job / conflict with the latest review unless forced.
- **Process shape**: simple polling loop by design — durable DB state, not
  in-memory events, is what makes lost work recoverable. LISTEN/NOTIFY or
  other wake-ups are future optimizations that must keep the polling
  fallback. Configured via `AI_REVIEW_SERVICE_URL`, `AI_REVIEW_RUNNER_*`
  (poll interval, batch size, lease, max attempts, backoff, timeout).
- **Observability**: structured events for enqueue/claim/request/persist/
  transition/retry/terminal/cancel; logs carry IDs, provider/model, verdict,
  compact errors — never full market text, evidence, or model output.
- **Public progress**: market reads map active work to `pending`, a persisted
  review to `complete`, and exhausted retries to `attention_required`. The app
  refreshes while pending and shows no speculative scores. Completed reviews
  store one concise rationale per score dimension.

## Implementation status and open questions

Landed per the doc: job schema/migration, enqueue+claim helpers with tests,
service client, runner loop behind package scripts, result persistence with
guarded transitions, the env-gated admin endpoint, and a local smoke
(`bun run smoke:ai-review-runner` / `just server-ai-review-smoke`) using the
heuristic provider. A future AWS PR runs service and runner as separate
ECS/Fargate services, keeping the indexer without model/web access
([deployment and infrastructure](../concepts/deployment-and-infrastructure.md)).

Open questions: whether `bypassAiResolution` should ever bypass moderation
(recommendation: no — it likely only affects later resolution automation);
whether approved reviews should emit an on-chain approval transaction
(recommendation: server projection first); automatic re-review on prompt
version changes (manual first); production auth for the manual endpoint
(env-gated internal first).

## Related pages

- [AI Review Next Phase summary](ai-review-next-phase.md) — the predecessor
  doc that called for this runner.
- [AI-assisted resolution](../concepts/ai-assisted-resolution.md) — the
  broader review/resolution program this slice belongs to.
- [Server workspace](../entities/server-workspace.md) — hosts the runner,
  service, and indexer as separate runtimes in one package.
