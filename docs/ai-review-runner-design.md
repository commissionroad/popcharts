# AI Review Runner Design

Status: Proposed

Date: 2026-06-23

## Context

Pop Charts now has three pieces of the market review system:

- The indexer records `MarketCreated` events and writes market projections as
  `under_review`.
- The standalone AI Review HTTP service reviews one market request at a time and
  returns a moderation and public-knowability result.
- The API read model can expose the latest persisted AI review from the
  append-only `market_ai_reviews` table.

The missing production-facing piece is the bridge between persisted markets and
the stateless AI Review service. That bridge should not live in the chain
indexer and should not be hidden inside the AI Review HTTP server.

## Decision

Add a separate AI Review runner process in `server/`.

The runner owns durable review work:

- discover eligible `under_review` markets with persisted metadata;
- enqueue or claim review jobs from PostgreSQL;
- call the pure AI Review HTTP service;
- persist immutable review attempts into `market_ai_reviews`;
- apply narrow market status transitions when the result is final;
- retry transport/runtime failures with backoff;
- expose the same path for manual re-review requests.

The runner is a separate runtime process from both the indexer and the AI Review
service, even though it shares the same `server` package and database schema.

```text
Indexer
  Watches chain.
  Writes event and market projections.
  Does not call models or review policy.

AI Review service
  Stateless HTTP API.
  Given one review request, returns one review result.
  Does not poll or mutate the market database.

Review runner
  Polls and claims DB work.
  Calls the AI Review service.
  Persists review attempts.
  Updates market projection through guarded status transitions.
```

## Goals

- Keep chain ingestion independent from model latency, provider failures, and
  web access.
- Keep the AI Review service stateless and easy to run locally or in AWS.
- Make missed, stuck, or manually requested reviews recoverable from database
  state.
- Preserve an audit trail of review attempts and provider outputs.
- Make duplicate runners safe through database leasing.
- Keep the first implementation small enough to verify with unit tests and
  lightweight local smoke checks.

## Non-Goals

- Do not move model prompts or provider logic into the runner.
- Do not make the indexer call the AI Review service.
- Do not add an admin UI in this slice.
- Do not deploy AWS infrastructure in this slice.
- Do not use `bypassAiResolution` as a review skip flag until its product
  semantics are explicitly confirmed. It currently travels through market
  creation and should not silently bypass moderation.
- Do not remove the existing on-chain `MarketReviewApproved` and
  `MarketReviewRejected` watcher in this slice.

## Current State

Relevant landed tables:

- `markets`
  - keyed by `chain_id` and `market_id`;
  - starts submitted markets as `under_review`;
  - has `metadata_hash`;
  - has a unique index on `(chain_id, market_id, metadata_hash)`.
- `market_metadata`
  - keyed by `(chain_id, metadata_hash)`;
  - stores question, category, description, resolution criteria, and optional
    resolution URL.
- `market_ai_reviews`
  - append-only review attempt/result table;
  - references `markets(chain_id, market_id, metadata_hash)`;
  - references `market_metadata(chain_id, metadata_hash)`;
  - stores provider, model ID, prompt version, verdict, scores, flags, reasons,
    source checks, evidence, and timestamps.

Existing chain review events:

- `MarketReviewApproved` moves a market projection to `bootstrap`.
- `MarketReviewRejected` moves a market projection to `rejected`.

The runner must not override a market that has already left `under_review`.
Runner status updates should use guarded updates such as:

```sql
where chain_id = $chain_id
  and market_id = $market_id
  and metadata_hash = $metadata_hash
  and status = 'under_review'
```

## Proposed Data Model

Add a durable job table. Suggested name:

```text
market_ai_review_jobs
```

Suggested enums:

```text
ai_review_job_status:
  queued
  running
  succeeded
  retryable_failed
  terminal_failed
  cancelled

ai_review_job_trigger:
  automatic
  manual
  retry
```

Suggested columns:

| Column | Purpose |
| --- | --- |
| `id` | Primary key. |
| `chain_id` | Market chain ID. |
| `market_id` | Market ID. |
| `metadata_hash` | Metadata version to review. |
| `status` | Queue lifecycle state. |
| `trigger` | Why this job exists. |
| `requested_provider` | Optional provider override. |
| `requested_model` | Optional model override. |
| `priority` | Manual jobs can outrank automatic jobs. |
| `attempt_count` | Number of claimed attempts. |
| `max_attempts` | Retry ceiling. |
| `run_after` | Backoff scheduling timestamp. |
| `lease_until` | Lock expiration for crashed runners. |
| `locked_by` | Runner instance ID that currently owns the job. |
| `last_error` | Compact error for operations. |
| `review_id` | Nullable FK to the final `market_ai_reviews` row. |
| `created_at` | Insert timestamp. |
| `updated_at` | Last job mutation timestamp. |
| `completed_at` | Terminal timestamp. |

Constraints:

- Composite FK to `markets(chain_id, market_id, metadata_hash)`.
- Composite FK to `market_metadata(chain_id, metadata_hash)`.
- Nullable FK from `review_id` to `market_ai_reviews(id)`.
- Index on `(status, run_after)`.
- Index on `(chain_id, market_id, metadata_hash)`.
- Partial unique index preventing duplicate active jobs for the same market and
  metadata hash:

```sql
unique (chain_id, market_id, metadata_hash)
where status in ('queued', 'running', 'retryable_failed')
```

If Drizzle cannot express the partial unique index cleanly, add it in the
generated migration and keep an explicit schema comment next to the table.

## Eligibility

The automatic discovery path should enqueue a job when all are true:

- `markets.status = 'under_review'`;
- a matching `market_metadata` row exists;
- no active job exists for `(chain_id, market_id, metadata_hash)`;
- no current successful review exists for the same market and metadata hash
  under the runner's current review freshness rule.

Initial freshness rule:

- If any `market_ai_reviews` row exists for the exact
  `(chain_id, market_id, metadata_hash)` and no manual force was requested, do
  not enqueue another automatic job.

Later freshness rule:

- Re-review when prompt version, configured provider, policy version, or source
  requirements change.

Manual requests can set `force: true` to enqueue another job even if a previous
review exists.

## Review Input Construction

The runner builds the AI Review service request from the database, not from
browser state.

Request context:

```json
{
  "chainId": 5042002,
  "marketId": "123",
  "creator": "0x..."
}
```

Request metadata:

```json
{
  "category": "Science",
  "createdAt": "2026-06-23T18:00:00.000Z",
  "description": "...",
  "metadataHash": "0x...",
  "question": "...",
  "resolutionCriteria": "...",
  "resolutionUrl": "https://..."
}
```

Runner options:

- Use the AI Review service default provider unless the job requested a provider.
- Use the service default model unless the job requested a model.
- Do not let market text influence provider choice, model choice, web access
  mode, retry count, or status transition behavior.

## Runner Claiming

Runner instances should claim jobs with PostgreSQL row locks, not process-local
state.

High-level claim flow:

```text
begin transaction
  select queued or retryable_failed jobs
    where run_after <= now()
      and (lease_until is null or lease_until < now())
    order by priority desc, run_after asc, id asc
    for update skip locked
    limit N

  update selected rows
    set status = 'running',
        locked_by = runner_id,
        lease_until = now() + lease_duration,
        attempt_count = attempt_count + 1,
        updated_at = now()
commit
```

This allows multiple runner processes to run without double-processing the same
job.

## Review Execution

For each claimed job:

1. Load the market and metadata rows by the job keys.
2. If either row is missing, mark the job `terminal_failed`. This should be
   rare because FKs should prevent it.
3. If market status is no longer `under_review`, mark the job `cancelled`.
4. Call the AI Review service `POST /reviews/market`.
5. On a valid response:
   - insert a `market_ai_reviews` row;
   - set `review_id`;
   - mark the job `succeeded`;
   - apply the guarded market status transition.
6. On transport timeout, connection failure, or non-2xx response:
   - mark `retryable_failed` if attempts remain;
   - compute `run_after` using exponential backoff;
   - store a compact `last_error`;
   - mark `terminal_failed` after the retry ceiling.

The runner should treat a valid `manual_review` response as a successful review
result. It should not parse reason strings to decide whether to retry. If we
need structured model-degraded retry behavior later, add an explicit field to
the AI Review result contract rather than parsing prose.

## Status Transitions

Only the runner mutates market status based on AI review results in this path.

| Review verdict | Market status action |
| --- | --- |
| `approve` | Change `under_review` to `bootstrap`. |
| `reject` | Change `under_review` to `rejected`. |
| `manual_review` | Leave `under_review`. |

The update must be guarded by current status and metadata hash. If the update
affects zero rows, the job can still be `succeeded` because the review attempt
was persisted, but the runner should log that the market had already moved.

The existing chain review watcher can still move a market to `bootstrap` or
`rejected`. Until we decide otherwise, chain review events and runner decisions
are two valid inputs to the same projection, and the guarded runner update keeps
them from overwriting each other.

## Manual Trigger

Add an internal API endpoint on the server API, not on the AI Review service:

```text
POST /admin/markets/:chainId/:marketId/review
```

Suggested body:

```json
{
  "force": false,
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "reason": "operator requested re-review"
}
```

Behavior:

- Resolve the current market and metadata rows.
- Enqueue a `manual` job.
- If `force` is false and an active job exists, return that job.
- If `force` is false and a review already exists for the current metadata hash,
  return a conflict with the latest review summary.
- If `force` is true, enqueue a new job unless another active manual job already
  exists.

Security:

- The endpoint must be disabled by default.
- First implementation can use a server-side environment gate such as
  `POPCHARTS_ADMIN_REVIEW_ENABLED=true`.
- Production should put it behind internal networking and real operator auth.

The endpoint should enqueue work. It should not call the AI Review service
directly.

## Process Shape

Add a new runtime entrypoint:

```text
server/src/ai-review-runner/index.ts
```

Add package scripts:

```json
{
  "dev:ai-review-runner": "bun run --watch src/ai-review-runner/index.ts",
  "start:ai-review-runner": "bun run src/ai-review-runner/index.ts"
}
```

Suggested runner env vars:

| Env var | Purpose |
| --- | --- |
| `AI_REVIEW_SERVICE_URL` | Base URL for the AI Review HTTP service. |
| `AI_REVIEW_RUNNER_ID` | Optional stable worker ID. |
| `AI_REVIEW_RUNNER_POLL_MS` | Poll interval. |
| `AI_REVIEW_RUNNER_BATCH_SIZE` | Max jobs claimed per loop. |
| `AI_REVIEW_RUNNER_LEASE_MS` | Lease duration. |
| `AI_REVIEW_RUNNER_MAX_ATTEMPTS` | Default retry ceiling. |
| `AI_REVIEW_RUNNER_BACKOFF_MS` | Base backoff duration. |
| `AI_REVIEW_RUNNER_REQUEST_TIMEOUT_MS` | HTTP timeout. |

The runner should have its own health marker or log heartbeat if deployed as a
separate container.

## Observability

Log structured events for:

- job enqueued;
- job claimed;
- review request started;
- review result persisted;
- market status transitioned;
- retry scheduled;
- terminal failure;
- cancelled because market moved.

Avoid logging full market descriptions, fetched evidence, or model output by
default. Store review details in `market_ai_reviews`; logs should only carry
IDs, provider/model names, verdict, and compact errors.

## Testing Plan

Unit tests:

- eligibility excludes markets without metadata;
- eligibility excludes non-`under_review` markets;
- eligibility excludes markets with active jobs;
- claim logic respects leases and increments attempt counts;
- successful `approve` persists review and moves market to `bootstrap`;
- successful `reject` persists review and moves market to `rejected`;
- `manual_review` persists review and leaves market `under_review`;
- guarded status update does not override already-moved markets;
- transport failures schedule retry with backoff;
- retry ceiling marks jobs `terminal_failed`;
- manual trigger returns existing active job unless forced.

Smoke tests:

- run API, AI Review service, and runner locally with `heuristic`;
- create or seed an `under_review` market plus metadata;
- observe job creation, review persistence, and market status change.

## Implementation Slices

Recommended next PR:

- Add `market_ai_review_jobs` schema and migration.
- Add job enqueue and claim helpers with tests.
- Add AI Review service client.
- Add runner process loop behind package scripts.
- Add result persistence and guarded status transition tests.

Follow-up PR:

- Add manual admin enqueue endpoint.
- Add operator docs.
- Add local smoke command or runbook.

AWS/deployment PR:

- Run AI Review service and runner as separate ECS/Fargate services.
- Give runner DB access and internal access to the AI Review service.
- Keep indexer without model/web access.

## Open Questions

- Should `bypassAiResolution` ever bypass moderation review, or does it only
  affect later resolution automation? Current recommendation: do not use it for
  review eligibility.
- Should approved AI reviews eventually emit an on-chain review approval
  transaction, or is a server projection transition enough for the pre-grad app
  lifecycle? Current recommendation: use server projection first; add signer
  workflow only if protocol enforcement requires it.
- Should prompt-version changes automatically enqueue re-reviews? Current
  recommendation: manual re-review first, automatic stale prompt detection later.
- What is the production auth mechanism for the manual endpoint? Current
  recommendation: environment-gated internal endpoint first, real operator auth
  before public exposure.
