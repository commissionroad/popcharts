---
type: summary
title: Repo ADR 0021 — Live market updates (SSE over a change-feed outbox)
description: Standalone program to make the app feel live — server-signalled, client-refetched updates over SSE, fed by a durable change_feed outbox written atomically with each indexed event via explicit recordLiveChange seams (not a DB trigger); DB/REST stays the single source of truth, no message broker. Server spine built 2026-07-22.
sources:
  - docs/adr/0021-live-market-updates.md
updated: 2026-07-22
---

# Repo ADR 0021: Live Market Updates (SSE over a Change-Feed Outbox)

**Status: Accepted — server spine built 2026-07-22, client transport
2026-07-23; slices 3–7 open, so the app still shows no live UI.** Dated
2026-07-17. A standalone tracked program (like
[0016](root-adr-0016-monorepo-architecture-cleanup-program.md)/
[0017](root-adr-0017-test-observability-and-coverage-program.md)), not part of
the M1–M5 launch chain. Two points where the shipped code overrode the original
draft: the emit point is explicit TypeScript `recordLiveChange` seams, **not** a
DB trigger; and the client hook delivers a **caller-supplied callback**, **not**
a React Query invalidation.

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
  entity's channel + a version; the subscribing surface re-reads the existing
  REST slice by its own means (multi-table composition stays server-side).
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
  transaction* as each change by an explicit `recordLiveChange(tx, …)` at every
  write seam: the [indexer](../entities/indexer.md) handlers for the `*_events`
  set plus the two off-chain runners that append `market_ai_reviews` /
  `market_resolutions`. Rejected: a **DB trigger** — writer-agnostic, but it
  buries an invisible side-effect in the data layer and needs a second schema
  installer outside the ORM; keeping the routing/logic in TypeScript (separation
  of concerns) won out. Also rejected: in-indexer-only emit (misses the off-chain
  runners' writes). The trigger's free completeness is recovered by a typed
  `sourceTable` + a coverage test scanning the seam dirs. Mutable-projection
  UPDATE signals (e.g. `market_ai_review_jobs` queue state) are deferred to the
  lifecycle/AI-review surface slice — they need join-based routing.
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
row_id, chain_id, market_id, owner, block_number, log_index)`. Each seam writes
one row via `recordLiveChange` atomically with the event; the relay tails
`WHERE id > cursor`, maps `source_table → channel` **in
TypeScript** (`change-feed/sources.ts`); reconnect replays
`WHERE id > Last-Event-ID`; retention is age-based (~48h; longer-offline clients
cold-refetch). The Postgres sequence-visibility gap is handled explicitly (small
lookback re-read + client dedup by id).

**Mapping & completeness.** Route by *entity*, not by component: every row
carries `market_id`/`owner`, so routing to `market:{chainId}:{marketId}` /
`portfolio:{owner}`
is a field read, and multi-table composition stays in the REST read (refetched
fresh). "Did we drop something?" reduces to "does this seam call
`recordLiveChange`?" — a coverage test scans the seam dirs (`src/indexer` + both
runners) and asserts the set of `sourceTable` literals there is exactly the
registry — a literal scan, so it catches a registered source with no seam, but
does not prove the literal sits on a call the write path reaches.
Whole-slice refetch of authoritative state makes duplicate/out-of-order/replayed
signals harmless (worst case: a redundant refetch). Deliberately does NOT emit
from `markets` UPDATEs — the coupled event row already covers them (no
double-signal). **The registered set is only slice 1's market-keyed append-only
tables**: `pool_price_ticks` / `venue_order_events` / `venue_orders`,
`outcome_token_transfer_events`, and the two job-queue UPDATE sources are
deferred to the slices that need them (each wants join-based or dual-party
routing).

### Scope boundaries

Deployment specifics — the SSE route behind the ALB, cross-origin CORS for the
Vercel app origin, and any session-mode DB connection bypassing RDS Proxy —
belong to [ADR 0015](root-adr-0015-deployment-and-infrastructure.md) per
[ADR 0007](root-adr-0007-track-verticals-with-progress-adrs.md). Confirmation-
depth / reorg emit timing belongs to
[ADR 0010](root-adr-0010-indexer-maturity.md); the signal-to-refetch model
degrades gracefully on reorg (re-emit → client refetches corrected state).

## Implementation slices

1. ✅ Outbox + relay + SSE endpoint (server spine) — **built 2026-07-22** as a
   7-PR stack under `server/src/change-feed/` (#281, #283, #287, #289, #291,
   #293 + a folder rename); explicit `recordLiveChange` seams, poll-based relay,
   `GET /events` with `Last-Event-ID`, coverage test.
2. ✅ Client transport layer — **built 2026-07-23** (#299, #302) under
   `app/src/integrations/live-updates/`: one shared `EventSource` provider
   (connecting **directly to the API origin**, since a serverless proxy would
   force-close the stream at its duration cap), `useLiveChannel(channel,
   onSignal)`, tab-hidden pause, jittered backoff, dedup by `id`. The hook hands
   each signal to a **caller-supplied callback** — it does *not* call
   `invalidateQueries`, and imports nothing from React Query, because the app
   does not keep market data there; each surface re-reads itself (`load()`, or
   `router.refresh()` for a server component). Unit-tested against a fake
   `EventSource` only — nothing has yet crossed a real SSE connection.
3. Pregrad live surfaces (discovery + detail prices/chart/graduation bar) —
   the first slice that renders anything live, and the first end-to-end proof.
4. Convert the three existing polls to push.
5. Lifecycle toasts + AI-review push + clearing challenge-window countdown.
6. Hardening/efficiency: finer-grained REST slices, optional scoped-value payloads, `change_feed` partitioning, optional NOTIFY. (Age-based retention already shipped in slice 1 — `startChangeFeedRetention`, started by the API.)
7. E2E coverage (a second actor's trade moves a first actor's open page).

## Exit criteria

A user on discovery, a market page, or their portfolio sees prices, graduation
bar, order book, positions, and lifecycle transitions update in place — driven by
other actors and chain events — without a refresh; a reconnected client recovers
every missed update via `Last-Event-ID`; the indexer stays a pure chain→DB
process with no dependency on the API.

## Consequences

Postgres gains a per-event `recordLiveChange` write (`change_feed`) that is now
part of each seam's write path (atomic, must be tested). The delivery guarantee
lives in the table, so the wake mechanism and even the transport can change
later without touching correctness. The append-only tables become a change contract — the
`source_table → channel` map is the one place new event types opt in. Multi-
instance fan-out needs no new infra (each API instance tails the same table);
Redis is deferred. The program leans on two open items elsewhere: finer-grained
read endpoints (this ADR) and confirmation-depth/reorg emit timing (ADR 0010).

## Related pages

- [../entities/indexer.md](../entities/indexer.md) — its handlers gain the `recordLiveChange` emit seam (still pure chain→DB)
- [../entities/server-workspace.md](../entities/server-workspace.md) — hosts the relay + SSE endpoint
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md) — the transitions that become live; the coarse-status trap
- [../concepts/deployment-and-infrastructure.md](../concepts/deployment-and-infrastructure.md) — where the SSE route/CORS/RDS-Proxy pieces land (M5)
- [root-adr-0010-indexer-maturity.md](root-adr-0010-indexer-maturity.md) — reorg/confirmation-depth dependency
- [portfolio-data-design.md](portfolio-data-design.md) — the money-paper-trail invariant the outbox rows respect
