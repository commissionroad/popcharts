---
type: concept
title: Backend drain-loop pattern
description: The one shape every backend process shares — a long-lived loop draining a durable seam, crash-recovered from the DB — and why the two AI subsystems add an isolated stateless service on top.
sources:
  - docs/backend-runtime-architecture.md
  - docs/ai-review-runner-design.md
  - docs/ai-resolution-service-design.md
  - docs/adr/0021-live-market-updates.md
  - docs/adr/0012-ai-assisted-resolution.md
updated: 2026-07-24
---

# Backend drain-loop pattern

The `server/` workspace runs several processes — API, indexer, AI review
service + runner, AI resolution service + runner, clearing keeper — but they are
not four bespoke designs. They share one shape: **a producer writes a durable
table (the seam), and a long-lived loop drains it, recovering from a crash by
re-reading the table rather than from memory.** A "runner" is just that loop; it
is not an AI-specific construct. The full comparison, diagram, and deployment
facts live in [backend runtime architecture](../../docs/backend-runtime-architecture.md).

## The four instances

- **[Indexer](../entities/indexer.md)** — drains the blockchain, checkpoints
  `indexer_cursors`, writes projection rows plus the `change_feed` outbox. It
  is the producer for the other three lanes.
- **API** — mostly request/response, but it also runs a small drain loop: the
  SSE relay tails `change_feed` ([ADR 0021](../summaries/root-adr-0021-live-market-updates.md)).
  See [server workspace](../entities/server-workspace.md).
- **[AI review](../entities/ai-review-service.md)** — a runner drains
  `market_ai_review_jobs` and submits `approveMarket` / `rejectMarket`.
- **AI resolution** — a runner drains `market_resolution_jobs` and submits
  `resolve(side)`; see [AI-assisted resolution](ai-assisted-resolution.md).

## The one difference: an isolated service

The two AI lanes add a stateless HTTP **service** the others lack, because their
work has a step that is simultaneously slow, failure-prone, internet-facing,
untrusted, and independently scalable (the model + evidence call). Splitting it
from the runner buys a **trust boundary** (the internet-facing model box holds no
chain key and no DB creds), **fault isolation** (a service hang/OOM/crash cannot
kill the queue-draining loop — the runner marks the job retryable and keeps its
lease), and **independent scaling**. The indexer has no such step to isolate, so
it stays one process.

Crucially, the runner's **durability comes from the leased job queue**
(`FOR UPDATE SKIP LOCKED`, `lease_until`), not from the split: a crashed runner's
job is reclaimed when its lease expires. The service split adds isolation,
security, and scaling on top of that durability — it is not its source.

## Why two runners, not one

Review and resolution are deliberate siblings (shared job-status enums, reused
`safe-web.ts`, mirrored `chain-*.ts`) kept as separate processes because they
differ on lifecycle stage (gates creation vs decides outcome), on-chain call and
key, blast radius (burns a creation vs mispays real money), and status
projection (review's runner UPDATEs `markets`; resolution defers to the
indexer's `MarketResolved` / `MarketCancelled` watcher, since operator override
and self-resolve are also actors). They share the pattern, not the process.

## Combining costs

Folding a service into its runner loses the trust boundary, independent scaling,
and the [ADR 0019](../summaries/root-adr-0019-ai-verdict-quality-program.md) eval
seam. Folding a runner into the API is blocked by the read-only rule (no chain
key on the public autoscaled tier) and the wrong scaling signal. Folding the
model call back into the indexer would block chain ingestion on model latency —
the very coupling the runner exists to prevent.

## Related pages

- [Backend runtime architecture (raw doc)](../../docs/backend-runtime-architecture.md) — full comparison, diagram, deployment facts
- [Indexer](../entities/indexer.md), [server workspace](../entities/server-workspace.md), [AI review service and runner](../entities/ai-review-service.md)
- [AI-assisted resolution](ai-assisted-resolution.md) — the post-graduation sibling
- [AI review runner design](../summaries/ai-review-runner-design.md), [AI resolution service & runner design](../summaries/ai-resolution-service-design.md)
- [Live market updates (ADR 0021)](../summaries/root-adr-0021-live-market-updates.md) — the API's own drain loop
