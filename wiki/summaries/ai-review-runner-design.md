---
type: summary
title: AI Review Runner Design (docs/ai-review-runner-design.md)
description: Superseded by ADR 0022 — the design record for the removed standalone review runner, now headed by a verified account of the in-API draft review loop that replaced it.
sources:
  - docs/ai-review-runner-design.md
updated: 2026-08-06
---

# AI Review Runner Design

Dated 2026-06-23. **Status as of 2026-08-06: superseded by
[ADR 0022](root-adr-0022-review-first-market-creation.md).** The separate runner
process this doc designed was built and has since been removed. The doc is kept
as the design record for the leased-job pattern that survived into draft review,
and now opens with a verified account of what replaced it.

## What replaced it (the doc's new opening section)

Review no longer runs in its own process and no longer reviews on-chain markets:

- A creator submits a draft. One transaction moves it to `in_review` and inserts
  a `market_draft_review_jobs` row, so review is never queued for unvalidated
  content.
- `startDraftReviewRunner()` polls that table once a second. The API starts it
  **in-process** when it runs as the main module (`server/src/api/index.ts:44`).
  There is no separate runner process to run or deploy.
- Each sweep claims up to three due jobs under a five-minute lease using
  `FOR UPDATE SKIP LOCKED`, reviews the submitted snapshot, and writes one
  `market_draft_reviews` row.
- The verdict moves the **draft**, never a market: `approve` → `approved`,
  `reject` → `rejected`, everything else → `changes_requested`.
- Failures retry with exponential backoff from 15s capped at 5min; after the
  last attempt the draft returns to `editing` with no review row written.
- The loop calls `reviewMarket()` **in process** — it does not call the review
  service over HTTP.

`server/README.md` is the operational reference for this behaviour; the design
doc is not. See [server README summary](server-readme.md).

## What the design describes that does not exist

The doc now carries this table, each row checked against code:

| Described | State |
| --- | --- |
| `server/src/ai-review-runner/index.ts` entrypoint | Absent; the whole directory is gone (its last orphaned files deleted 2026-08-06) |
| `dev:`/`start:`/`smoke:ai-review-runner` scripts | Absent from `server/package.json` |
| `market_ai_review_jobs`, `market_ai_reviews` | Retired with ADR 0022 P5; live tables are `market_draft_review_jobs`, `market_draft_reviews` |
| `POST /admin/markets/:chainId/:marketId/review` | No `/admin` route exists |
| `POPCHARTS_ADMIN_REVIEW_ENABLED` | Written by local env scripts, read by no server code |
| `approveMarket` / `rejectMarket` | Absent from `server/src` |
| `POPCHARTS_REVIEW_MANAGER_PRIVATE_KEY` | Read by no code; still declared in `server/sample.env` |
| `AI_REVIEW_RUNNER_*` env vars | None exist; the values are constants in `server/src/draft-review/runner.ts` |
| `markets` transitions to `bootstrap` / `rejected` | Draft review moves drafts, not markets |
| `AI_REVIEW_SMOKE_PORT` | Defined and read by nothing |

There is no operator re-review trigger. Re-review is creator-driven: the owner
resubmits a draft that is `editing`, `changes_requested`, or `rejected`.

## The historical design (retained below the fold)

The original decision was a **separate** runner process in `server/`, distinct
from both the [indexer](../entities/indexer.md) and the stateless
[AI Review service](../entities/ai-review-service.md), owning durable review
work: discover `under_review` markets, claim jobs from PostgreSQL, call
`POST /reviews/market`, persist immutable attempts to `market_ai_reviews`, apply
guarded status transitions, and retry with backoff.

Its data model was `market_ai_review_jobs` — job keys
`(chain_id, market_id, metadata_hash)` with the hash preventing stale reviews
applying to changed metadata, `requested_provider`/`requested_model` overrides,
`priority`, attempt counters, `run_after` backoff, `lease_until`/`locked_by` for
multi-runner safety, and a partial unique index forbidding duplicate active jobs.
Claiming was `SELECT ... FOR UPDATE SKIP LOCKED`; transitions were guarded on
`status = 'under_review'` plus the metadata hash.

**What survived into draft review** is the pattern, not the tables: the leased
job queue as the source of durability, the content-addressed snapshot hash, the
retry/backoff semantics, and the argument that polling is what makes lost work
recoverable. **What did not survive**: the separate process, the HTTP hop to the
service, the on-chain transitions and review-manager key, the admin enqueue
endpoint, and both original tables.

Open questions the doc still lists (all now moot for review, since it holds no
chain key and gates a draft rather than a paid-for market): whether
`bypassAiResolution` should bypass moderation, whether approved reviews should
emit an on-chain approval, automatic re-review on prompt-version change, and
production auth for the manual endpoint.

## Related pages

- [Server README summary](server-readme.md) — how draft review actually runs
- [Repo ADR 0022](root-adr-0022-review-first-market-creation.md) — the supersession
- [Backend drain-loop pattern](../concepts/backend-drain-loop-pattern.md) — the pattern that survived
- [AI review service and runner](../entities/ai-review-service.md) — the entity page
- [AI Review Next Phase summary](ai-review-next-phase.md) — the predecessor doc that called for this runner
- [Server workspace](../entities/server-workspace.md)
