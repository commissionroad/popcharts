---
type: summary
title: Repo ADR 0021 — Live market updates (SSE over a change-feed outbox)
description: Proposed standalone program to make the app feel live — server-signalled, client-refetched updates over SSE, fed by a durable change_feed outbox written atomically with each indexed event; DB/REST stays the single source of truth, no message broker.
sources:
  - docs/adr/0021-live-market-updates.md
updated: 2026-07-17
---

# Repo ADR 0021: Live Market Updates (SSE over a Change-Feed Outbox)

**Status: Proposed.** Dated 2026-07-17. A standalone tracked program (like
[0016](root-adr-0016-monorepo-architecture-cleanup-program.md)/
[0017](root-adr-0017-test-observability-and-coverage-program.md)), not part of
the M1–M5 launch chain.

## Context

A 2026-07-17 sweep found the app is essentially a snapshot: the highest-traffic
page (market discovery) has zero client refresh, pregrad market-detail prices /
LMSR chart / graduation bar move only on the *viewer's own* trade, only three
surfaces poll (order book 5s, open orders 8s, portfolio 15s), and AI-review
"liveness" is a whole-page `router.refresh()` every 2s. Lifecycle transitions
(create, graduate, resolve, cancel) never surface live. Goal: update these in
place at Arc's cadence (subsecond finality, many events/sec) without a refresh.

## Decision

Server-signalled, client-refetched updates over **Server-Sent Events**, fed by a
durable **`change_feed` outbox**. The DB/REST projection stays the single source
of truth; the socket carries a small signal, not the data. Four axes:

- **Payload — signal-to-refetch by default.** The message carries the changed
  entity's channel + a version; the client invalidates its React Query key and
  refetches the existing REST slice (multi-table composition stays server-side).
  **One data-in-message exception from day one — the price/chart channel**: it
  pushes the new point `{ t, yesPrice, noPrice, sequence }` (client appends;
  headline price + graduation bar ride along in the same message; full chart
  refetch as the gap/reconnect resync), because the chart is append-mostly and a
  refetch is O(history) for O(1) new info. The order book is the likely *second*
  such channel if postgrad volume grows. Rejected: exchange-style additive delta
  streaming everywhere (verified terminals research: justified only at their
  thousands-of-ticks/sec cadence, not ours).
- **Transport — SSE on the long-running Bun/Elysia API.** Server→client only
  (trades already POST), so SSE's free auto-reconnect + `Last-Event-ID` resume +
  sequence ids beat WebSocket. Not hosted on Vercel (functions force-close at the
  duration cap). WebSocket kept in reserve for a future bidirectional need.
- **Emit point — a `change_feed` outbox table**, written in the *same
  transaction* as each change by a generic trigger — `AFTER INSERT` on the
  append-only tables (`*_events` + `market_ai_reviews` + `market_resolutions`)
  and `AFTER UPDATE` on the few mutable projections whose in-place transition
  is the signal (e.g. `market_ai_review_jobs` queue state).
  Writer-agnostic (catches the [indexer](../entities/indexer.md), the AI-review
  runner, and the keeper), fires only on committed rows, and auto-suppresses the
  `MarketNotIndexedError` rollback path. Rejected: in-indexer emit (can't cross
  the indexer/API process boundary; misses non-indexer writers).
- **Delivery guarantee — the outbox table + a per-client cursor**
  (`Last-Event-ID`), *not* `NOTIFY`. Rejected: a message broker (SQS/Rabbit/
  Kafka). A broker's dividends — durable fan-out to **multiple independent
  consumers**, cross-service decoupling, throughput beyond a single-Postgres
  tail — don't apply: there is one consumer (the SSE relay) reading one indexed
  table, the outbox already gives durability/ordering/replay, and a broker still
  couldn't hold the SSE connections (the API stays in the path). First upgrade if
  ever outgrown is Redis Streams / logical-decoding CDC feeding the same relay,
  deferred until a second consumer or a measured bottleneck exists.

### Why the outbox, not raw NOTIFY

`NOTIFY` has no delivery guarantee (a disconnected listener misses events) and
serializes NOTIFY-issuing commits cluster-wide via an `AccessExclusiveLock` held
through commit (verified vs. the Postgres source + the recall.ai writeup), so it
is unsafe as a per-event high-throughput primitive — and prod's RDS Proxy
transaction pooling doesn't support session-pinned `LISTEN` anyway. The outbox
provides durability/resume; **waking the relay is a swappable detail**: ship
short-interval polling first (cheap indexed scan, works through RDS Proxy, zero
NOTIFY), add a coalesced NOTIFY doorbell (one per committed indexer batch, never
per event) later only if sub-250ms latency is wanted. Both give identical
correctness because the table is the source of truth.

### The change_feed table

`change_feed(id bigserial pk /* == Last-Event-ID */, created_at, source_table,
row_id, chain_id, market_id, owner, block_number, log_index)`. Trigger writes one
row atomically with the event; the relay tails `WHERE id > cursor`, maps
`source_table → channel + React Query key` **in TypeScript** (trigger stays
dumb); reconnect replays `WHERE id > Last-Event-ID`; retention ~24–48h
(prune/partition, longer-offline clients cold-refetch). The Postgres
sequence-visibility gap is handled explicitly (small lookback re-read + client
dedup by id).

**Mapping & completeness.** Route by *entity*, not by component: every row
carries `market_id`/`owner`, so routing to `market:{id}` / `portfolio:{owner}`
is a field read, and multi-table composition stays in the REST read (refetched
fresh). "Did we drop something?" reduces to "is this table in the trigger set?"
— an enumerable list plus a single TS `source_table → channel → query-key`
registry and a coverage test (every triggered table maps to ≥1 channel; every
page's query keys are reachable). Whole-slice refetch of authoritative state
makes duplicate/out-of-order/replayed signals harmless (worst case: a redundant
refetch). Deliberately does NOT trigger `markets` UPDATEs — the coupled event
row already covers them (no double-signal).

### Scope boundaries

Deployment specifics — the SSE route behind the ALB, cross-origin CORS for the
Vercel app origin, and any session-mode DB connection bypassing RDS Proxy —
belong to [ADR 0015](root-adr-0015-deployment-and-infrastructure.md) per
[ADR 0007](root-adr-0007-track-verticals-with-progress-adrs.md). Confirmation-
depth / reorg emit timing belongs to
[ADR 0010](root-adr-0010-indexer-maturity.md); the signal-to-refetch model
degrades gracefully on reorg (re-emit → client refetches corrected state).

## Implementation slices (all open)

1. Outbox + relay + SSE endpoint (server spine).
2. Client transport layer (one shared `EventSource` provider, `invalidateQueries`).
3. Pregrad live surfaces (discovery + detail prices/chart/graduation bar).
4. Convert the three existing polls to push.
5. Lifecycle toasts + AI-review push + clearing challenge-window countdown.
6. Hardening/efficiency: finer-grained REST slices, optional scoped-value payloads, retention, optional NOTIFY.
7. E2E coverage (a second actor's trade moves a first actor's open page).

## Exit criteria

A user on discovery, a market page, or their portfolio sees prices, graduation
bar, order book, positions, and lifecycle transitions update in place — driven by
other actors and chain events — without a refresh; a reconnected client recovers
every missed update via `Last-Event-ID`; the indexer stays a pure chain→DB
process with no dependency on the API.

## Consequences

Postgres gains a per-event trigger write (`change_feed`) that is now part of the
indexer's write path (atomic, must be tested). The delivery guarantee lives in
the table, so the wake mechanism and even the transport can change later without
touching correctness. The append-only tables become a change contract — the
`source_table → channel` map is the one place new event types opt in. Multi-
instance fan-out needs no new infra (each API instance tails the same table);
Redis is deferred. The program leans on two open items elsewhere: finer-grained
read endpoints (this ADR) and confirmation-depth/reorg emit timing (ADR 0010).

## Related pages

- [../entities/indexer.md](../entities/indexer.md) — the change_feed trigger is its new (still pure) emit seam
- [../entities/server-workspace.md](../entities/server-workspace.md) — hosts the relay + SSE endpoint
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md) — the transitions that become live; the coarse-status trap
- [../concepts/deployment-and-infrastructure.md](../concepts/deployment-and-infrastructure.md) — where the SSE route/CORS/RDS-Proxy pieces land (M5)
- [root-adr-0010-indexer-maturity.md](root-adr-0010-indexer-maturity.md) — reorg/confirmation-depth dependency
- [portfolio-data-design.md](portfolio-data-design.md) — the money-paper-trail invariant the outbox rows respect
