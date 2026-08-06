---
type: concept
title: Backend drain-loop pattern
description: The one shape every backend process shares — a long-lived loop draining a durable seam, crash-recovered from the DB — plus why resolution isolates its model call behind a stateless service and why draft review folded back into the API.
sources:
  - docs/backend-runtime-architecture.md
  - docs/ai-review-runner-design.md
  - docs/ai-resolution-service-design.md
  - docs/adr/0021-live-market-updates.md
  - docs/adr/0012-ai-assisted-resolution.md
  - docs/adr/0022-review-first-market-creation.md
updated: 2026-08-06
---

# Backend drain-loop pattern

The `server/` workspace runs several processes — API, indexer, AI resolution
service + runner, clearing keeper — but they are not bespoke designs. They share
one shape: **a producer writes a durable table (the seam), and a long-lived loop
drains it, recovering from a crash by re-reading the table rather than from
memory.** A "runner" is just that loop; it is not an AI-specific construct. The
full comparison, diagram, and deployment facts live in
[backend runtime architecture](../../docs/backend-runtime-architecture.md).

## The four instances

- **[Indexer](../entities/indexer.md)** — drains the blockchain, checkpoints
  `indexer_cursors`, writes projection rows plus the `change_feed` outbox. It is
  the producer for the API and resolution lanes.
- **API** — mostly request/response, but it also runs drain loops: the SSE relay
  tails `change_feed` ([ADR 0021](../summaries/root-adr-0021-live-market-updates.md)),
  and since ADR 0022 it also runs the draft review loop.
  See [server workspace](../entities/server-workspace.md).
- **[Draft review](../entities/ai-review-service.md)** — drains
  `market_draft_review_jobs` and applies the verdict as a `market_drafts` status
  change. Its producer is the **API**, not the indexer, because a draft never
  touches the chain. It has no process of its own.
- **AI resolution** — a runner drains `market_resolution_jobs` and submits
  `resolve(side)`; see [AI-assisted resolution](ai-assisted-resolution.md).

## The one difference: an isolated service

Resolution adds a stateless HTTP **service** the others lack, because its work
has a step that is simultaneously slow, failure-prone, internet-facing,
untrusted, and independently scalable (the model + evidence call). Splitting it
from the runner buys a **trust boundary** (the internet-facing model box holds no
chain key and no DB creds), **fault isolation** (a service hang/OOM/crash cannot
kill the queue-draining loop — the runner marks the job retryable and keeps its
lease), and **independent scaling**. The indexer has no such step to isolate, so
it stays one process.

Crucially, the loop's **durability comes from the leased job queue**
(`FOR UPDATE SKIP LOCKED`, `lease_until`), not from the split: a crashed runner's
job is reclaimed when its lease expires. The service split adds isolation,
security, and scaling on top of that durability — it is not its source. Draft
review is the proof: it dropped the split and kept the durability.

## Why draft review folded back into the API

Review once had resolution's two-process shape. ADR 0022 removed the reason for
it, and the code followed (verified against `server/src` on 2026-08-06):

- **No chain key left to protect.** ADR 0022 P5 deleted the on-chain review
  machinery — `approveMarket`/`rejectMarket` appear nowhere in `server/src` and
  nothing reads `POPCHARTS_REVIEW_MANAGER_PRIVATE_KEY`. A verdict is a status
  update on a draft row, so the trust boundary had nothing to guard.
- **Blast radius shrank.** A wrong review used to burn a paid-for on-chain
  market irreversibly. Now it moves a private, editable draft; the creator edits
  and resubmits, enqueuing a fresh job.
- **The HTTP hop went too.** The loop calls `reviewMarket()` in process. The
  stateless review service still exists (`server/src/ai-review/server.ts`, port
  3002) but nothing in the live path calls it — no server code reads
  `AI_REVIEW_SERVICE_URL`, its only HTTP caller is the ADR 0019 eval harness, and
  it has no container in the CDK stack.
- **The cost that stayed.** The model call now shares the API process, and the
  API autoscales on request load — the wrong signal for a queue worker. The code
  answers that by defaulting draft review to the deterministic `heuristic`
  provider (`POPCHARTS_DRAFT_REVIEW_PROVIDER` opts into a model), which is what
  keeps the shared process cheap.

Running in every API replica is safe for the same reason two runners would be:
claims are leased and completion is fenced on still holding the lease.

## Why review and resolution never merged

They are deliberate siblings (shared job-status enums in
`server/src/db/schema/job-queue.ts`, reused `safe-web.ts` and evidence schemas)
that were never merged into one loop — and the fold widened the gap. They differ
on lifecycle stage (gates creation vs decides outcome), on-chain call and key
(none vs a resolver key), blast radius (an editable draft vs mispaying real
money), process (inside the API vs its own Fargate task), and status projection
(the loop UPDATEs `market_drafts`; resolution defers to the indexer's
`MarketResolved` / `MarketCancelled` watcher, since operator override and
self-resolve are also actors). They share the pattern, not the process.

## Combining costs

Draft review has now answered two of the three combine questions in practice,
which is why they are stated as trade-offs rather than rules:

- **Fold the service into the loop** — costs the trust boundary, independent
  scaling, and the [ADR 0019](../summaries/root-adr-0019-ai-verdict-quality-program.md)
  eval seam. Review took this trade (no key to protect; the eval seam still runs
  against the standalone service). Resolution has not.
- **Fold the loop into the API** — the decisive objection (a chain key on every
  public replica) did not apply to review. The read-only rule survives: it bars
  operator and key-holding writes, and a draft status update is neither. The
  scaling mismatch is real and still being paid.
- **Fold the model call into the indexer** — would block chain ingestion on
  model latency, the coupling the resolution runner exists to prevent. It never
  applied to review, whose producer is the API.

## Related pages

- [Backend runtime architecture (raw doc)](../../docs/backend-runtime-architecture.md) — full comparison, diagram, deployment facts
- [Indexer](../entities/indexer.md), [server workspace](../entities/server-workspace.md), [AI review service and runner](../entities/ai-review-service.md)
- [AI-assisted resolution](ai-assisted-resolution.md) — the post-graduation sibling
- [Repo ADR 0022](../summaries/root-adr-0022-review-first-market-creation.md) — why review's lane changed shape
- [AI review runner design](../summaries/ai-review-runner-design.md) (superseded), [AI resolution service & runner design](../summaries/ai-resolution-service-design.md)
- [Live market updates (ADR 0021)](../summaries/root-adr-0021-live-market-updates.md) — the API's other drain loop
