---
type: summary
title: Repo ADR 0021 — Live market updates (SSE over a change-feed outbox)
description: Proposed live-update program — SSE invalidations over a transactional semantic outbox, with subscribe-then-refetch correctness, best-effort cursors, and mandatory age-based retention.
sources:
  - docs/adr/0021-live-market-updates.md
updated: 2026-07-21
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
  (trades already POST), so SSE's auto-reconnect and simple streaming model beat
  WebSocket. Not hosted on Vercel. `Last-Event-ID` is only an optimization.
- **Emit point — an explicit in-transaction outbox write.** Every production
  writer calls a shared `recordLiveChange(tx, change)` module (built) through the
  same Drizzle transaction as its authoritative write; rollback suppresses both.
  The caller names a typed `sourceTable` (a registered source — unrouted tables
  are a compile error) and passes the routing/version columns it already holds; a
  coverage test asserts the seams cover exactly the registry. This replaced PR
  #249's generic capture trigger, keeping live-feed logic in visible TypeScript
  and dropping the second schema installer. The larger `kind`/`owners[]`/`payload`
  redesign was trimmed as premature — a two-party transfer records one row per
  owner, and a data-in-message payload column arrives only with the chart slice.
- **Delivery guarantee — subscribe first, then refetch authoritative REST state
  on every connect/reconnect.** A `bigserial` cursor is not commit order and
  cannot guarantee exact replay. Incremental payloads use their domain sequence
  and snapshot-refetch on reconnect/gap. A broker and raw `NOTIFY` remain
  rejected for the original reasons.

## PR #249 architecture correction

Two checked-in regression tests demonstrate the failure: transaction A can
reserve a lower sequence id, transaction B can commit a higher id and advance
the browser cursor, then A can commit below that cursor. Both the authoritative
event and outbox row exist, but `WHERE id > Last-Event-ID` cannot recover the
late row. The relay lookback only helps a currently connected client. This is a
missed invalidation, **not loss of indexed blockchain data**.

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

Shape (as built): `change_feed(id bigserial pk, created_at, source_table, op,
row_id, chain_id, market_id, owner, block_number, log_index)`. The id is a
scan/dedup cursor, not a commit-order guarantee. Each write seam records one row
atomically with authoritative state; the relay routes it via
`CHANGE_FEED_SOURCES[source_table]`.

**Retention is part of the spine (built).** An always-on, bounded, age-based
(~48h) prune runs with the API — not gated on SSE clients, since the indexer
appends regardless. Delete rows by age in bounded, observable batches using the
`created_at` index, or later drop time
partitions. Never delete “when consumed”: browsers and API instances have
independent cursors and there is no global acknowledgement. Reconnect refetch
makes correctness independent of the retention horizon.

**Mapping & completeness.** Route by entity, not component. Production writes
go through persistence modules that record authoritative state and semantic live
changes together. Contract tests cover every viewer-facing write and subscribed
query key. This lets pool/token writers perform their lookup once and transfers
name both owners without moving domain logic into PL/pgSQL.

### Scope boundaries

Deployment specifics — the SSE route behind the ALB, cross-origin CORS for the
Vercel app origin, and any session-mode DB connection bypassing RDS Proxy —
belong to [ADR 0015](root-adr-0015-deployment-and-infrastructure.md) per
[ADR 0007](root-adr-0007-track-verticals-with-progress-adrs.md). Confirmation-
depth / reorg emit timing belongs to
[ADR 0010](root-adr-0010-indexer-maturity.md); the signal-to-refetch model
degrades gracefully on reorg (re-emit → client refetches corrected state).

## Implementation slices (slice 1 built; 2–7 open)

1. Outbox + relay + SSE endpoint (server spine). **Built (PR #249).** change_feed
   table + migration; poll-based relay + hub with lookback/dedup for the
   sequence-visibility gap; `GET /events` SSE with best-effort `Last-Event-ID`;
   always-on ~48h age-based pruning. Emit is an explicit `recordLiveChange(tx, …)`
   at each write seam (no trigger), covering the market-keyed sources plus the
   AI-review/resolution runners, with a coverage test enforcing completeness.
   Subscribe-then-refetch is the reconnect contract; cursor replay is best-effort
   (the two reconnect tests characterize that, not a red guarantee). Deferred
   hardening: a txid low-watermark cursor for the below-cursor replay gap.
2. Client transport layer (one shared `EventSource` provider, `invalidateQueries`).
3. Pregrad live surfaces (discovery + detail prices/chart/graduation bar).
4. Convert the three existing polls to push.
5. Lifecycle toasts + AI-review push + clearing challenge-window countdown.
6. Hardening/efficiency: finer-grained REST slices, optional scoped-value payloads, optional partitioning beyond the mandatory bounded TTL prune, optional NOTIFY.
7. E2E coverage (a second actor's trade moves a first actor's open page).

## Exit criteria

A user on discovery, a market page, or their portfolio sees prices, graduation
bar, order book, positions, and lifecycle transitions update in place. A
reconnected client subscribes and refetches authoritative state, so missed or
pruned invalidations cannot leave it stale. The indexer stays a pure chain→DB
process with no dependency on the API.

## Consequences

Postgres gains a semantic outbox write in each viewer-facing transaction, plus a
relay tail and mandatory retention job. Correctness lives in authoritative
refetch, so polling/NOTIFY, retention, cursor optimization, and transport remain
replaceable. Multi-instance fan-out needs no new infra yet; Redis is deferred.

## Related pages

- [../entities/indexer.md](../entities/indexer.md) — production write modules record semantic outbox rows in the same DB transaction
- [../entities/server-workspace.md](../entities/server-workspace.md) — hosts the relay + SSE endpoint
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md) — the transitions that become live; the coarse-status trap
- [../concepts/deployment-and-infrastructure.md](../concepts/deployment-and-infrastructure.md) — where the SSE route/CORS/RDS-Proxy pieces land (M5)
- [root-adr-0010-indexer-maturity.md](root-adr-0010-indexer-maturity.md) — reorg/confirmation-depth dependency
- [portfolio-data-design.md](portfolio-data-design.md) — the money-paper-trail invariant the outbox rows respect
