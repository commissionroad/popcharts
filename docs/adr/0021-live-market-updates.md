# ADR 0021: Live Market Updates (SSE over a Change-Feed Outbox)

Status: Proposed

Date: 2026-07-17

## Context

The app is a snapshot. Almost nothing updates without a manual reload, which
is the wrong feel for a live prediction market. A 2026-07-17 sweep of every
page (10-agent research pass) found:

- **The highest-traffic page — market discovery — is fully static.** It is a
  load-time server snapshot with zero client refresh; the outcome prices and
  the graduation progress bar on every card only move on navigation/reload.
- **Pregrad market detail moves only on the viewer's *own* trade.** Headline
  YES/NO prices, the LMSR price chart, and the graduation bar are
  server-rendered and refreshed client-side only by `router.refresh()` after
  *your* trade — another trader's activity never moves them for you. This is
  the single biggest liveness gap.
- **Only three surfaces poll**, each through an indexer proxy route: the
  postgrad order book (5s, `app/src/features/order-book/use-order-book.ts`),
  open venue orders (8s), and portfolio (15s, the slowest, money-bearing).
- **AI review "liveness" is a sledgehammer**: a whole-page `router.refresh()`
  every 2s while a market is `under_review`.
- **Lifecycle transitions are invisible live**: a market being created,
  graduating, graduating→graduated, resolving, or being cancelled never
  surfaces to a viewer who is already on the page or the list.

We want these to update in place, without a refresh, at Arc's cadence
(subsecond finality, potentially many on-chain events per second).

The research also pinned down the constraints that shape the design:

- **The indexer and the API are separate OS processes** (separate ECS Fargate
  services in prod per [ADR 0015](0015-deployment-and-infrastructure.md)),
  sharing only RDS Postgres. An in-process event bus in the indexer cannot
  reach a client connected to the API — any cross-process signal must travel
  through Postgres. The indexer is deliberately *pure* (chain → DB only; it
  never calls the API, models, or the network beyond RPC), and must stay that
  way.
- **`markets.status` is coarser than the real lifecycle**
  (`server/src/db/schema/markets.ts`, 8 states): clearing-root-submitted,
  postgrad trading, and redemption have no status value and exist only as
  `*_events` rows. Any change feed keyed on `markets.status` alone silently
  drops the challenge-window countdown, postgrad price ticks, and claims.
- **Projections are rebuildable from the append-only `*_events` tables**, and
  reorg handling ([ADR 0010](0010-indexer-maturity.md)) rewinds them. A
  "re-read authoritative state on change" model self-heals on reorg; a
  "stream additive deltas" model would have to emit compensating undo deltas.
- **The read API is already a near drop-in for a refetch model**: every live
  surface already has a REST endpoint returning the fresh value, all read
  paths already run `cache: "no-store"`, and `serializeMarketRow` returns a
  complete market object in one call. What is missing is finer-grained slices
  (per-market portfolio, a standalone current-price endpoint), not coverage.
- **In prod the DB is fronted by RDS Proxy** (transaction pooling), which does
  not support session-pinned `LISTEN`; and Postgres `NOTIFY` serializes the
  commits of NOTIFY-issuing transactions cluster-wide (an `AccessExclusiveLock`
  held through commit — verified against the Postgres source and the recall.ai
  writeup), so NOTIFY is unsafe as a per-event, high-throughput primitive.

Industry check (verified against Binance / Coinbase / Kraken / Polymarket /
Bloomberg-Refinitiv primary docs): high-throughput terminals stream
snapshot+incremental-delta data over the socket with sequence numbers and
checksums, because their order books mutate thousands of times per second.
That machinery (client-side book reconstruction, gap detection, resync) is
justified only at that cadence. Pop Charts is driven by discrete on-chain
events, so the tradeoff inverts: we keep the DB projection as the single
source of truth and use the socket as a lightweight signal. This is a
standalone tracked program (like ADRs 0016–0020), not part of the M1–M5
launch chain.

## Decision

Build live updates as **server-signalled, client-refetched updates delivered
over Server-Sent Events, fed by a durable change-feed outbox**. The DB/REST
projection stays the single source of truth; the socket carries a small
signal, not the data.

### Architecture review correction (2026-07-20)

PR #249's first implementation proved that a `bigserial` outbox id cannot be
the correctness boundary for reconnect replay. PostgreSQL sequences reflect
allocation order, not commit order: transaction A can reserve id 7, transaction
B can reserve and commit id 8, a client can persist `Last-Event-ID: 8`, and A
can then commit id 7. The row exists, but `WHERE id > 8` can never return it.
The relay's bounded lookback can recover that ordering while a client remains
connected, but it cannot repair an already-advanced reconnect cursor.

Regression tests in `change-feed-relay.pglite.test.ts` and
`change-feed-stream.test.ts` reproduce the loss at the replay-query and SSE
stream seams. A separate two-connection PostgreSQL probe reproduced the real
commit ordering. This is **not loss of the authoritative blockchain-derived
event**: the raw event and its outbox row both commit. It is loss of the
secondary invalidation signal through an invalid high-watermark assumption.

Therefore:

- `Last-Event-ID` replay is an optimization, never the delivery guarantee.
- Every initial connection and reconnect establishes correctness by subscribing
  first and then refetching the authoritative REST queries for its channels.
- Incremental data-bearing channels (the price chart) refetch a snapshot on
  reconnect and use their domain sequence to detect later gaps.
- The outbox should carry explicit semantic changes written by the owning
  application transaction, rather than infer domain meaning from physical
  table names and nullable JSON fields in a generic DB trigger.
- Time-based pruning is part of the production-ready spine, not optional
  hardening. Rows are never deleted "when consumed" because browsers and API
  instances have independent cursors and there is no global consumer.

Four decisions, with the alternatives we rejected:

| Axis | Decision | Rejected |
| --- | --- | --- |
| **Payload** | **Signal-to-refetch by default**: the message carries the changed entity's channel + a version; the client invalidates its React Query key and refetches the existing REST slice (multi-table composition stays server-side). **One data-in-message exception, from day one — the price/chart channel** (see below), which pushes the new point itself. | Additive delta streaming *everywhere* (exchange-style book reconstruction, checksums, resync) — unjustified at our cadence outside the append-mostly chart. |
| **Transport** | SSE on the long-running Bun/Elysia API. | WebSocket — we have no client→server stream (trades already POST); SSE gives auto-reconnect and a simple server→client stream. `Last-Event-ID` may reduce redundant refetches but is not a correctness boundary. Hosting on Vercel — its functions force-close at the duration cap with no reconnect affinity. |
| **Emit point** | A durable semantic `change_feed` row written through a shared helper using the **same DB transaction** as the authoritative write. Every writer (indexer, AI runners, keeper) uses the helper; rollback suppresses both writes. | A generic table trigger — it hides behavior outside the TypeScript transaction, couples live semantics to physical table/column names, requires a second schema installer, and already cannot express pool joins or two-owner transfer routing without becoming application logic in PL/pgSQL. Direct indexer→API emit remains rejected because it crosses processes and misses other writers. |
| **Delivery guarantee** | **Subscribe first, then refetch authoritative REST state on every connect/reconnect.** Live outbox rows reduce latency while connected; domain sequences detect gaps for incremental payloads. | Treating `bigserial` + `Last-Event-ID` as exact commit-ordered replay — disproven by the PR #249 regression tests. A message broker remains unwarranted; `NOTIFY` alone remains non-durable. |

### The change-feed outbox

`change_feed` is an append-only "something changed" log, written atomically
with the data change so the two can never disagree:

```
change_feed(
  id            bigserial primary key,   -- scan/dedup cursor, not commit order
  created_at    timestamptz not null default now(),
  source_table  text    not null,        -- registered source; routes via CHANGE_FEED_SOURCES
  op            text    not null,        -- 'insert' | 'update'
  row_id        text,                    -- changed row PK, diagnostic
  chain_id      integer,
  market_id     text,                    -- routes to channel  market:{chainId}:{marketId}
  owner         text,                    -- routes to channel  portfolio:{owner}
  block_number  bigint,  log_index integer  -- on-chain version, for client dedup/ordering
)
```

The columns are the routing/versioning minimum, not domain data. A two-owner
transfer records two rows rather than an `owners[]`, and a data-in-message
payload column arrives only with the price/chart slice that needs it — neither is
built here.

1. **Write (atomic, explicit).** A shared `recordLiveChange(tx, change)` module
   (`src/live/change-feed-writer.ts`) inserts one change_feed row through the same
   Drizzle transaction as the raw event/projection mutation. The caller names the
   `sourceTable` (typed as a registered source, so an unrouted table is a compile
   error) and passes the routing/version columns it already has in hand. If the
   transaction commits, both writes commit; if it rolls back (including
   `MarketNotIndexedError`), neither does. Each seam is one call at the end of its
   existing persist transaction; a coverage test asserts the recorded source set
   is exactly the registry, replacing the completeness the trigger gave for free.
2. **Relay.** The API keeps a cursor, reads
   `SELECT … FROM change_feed WHERE id > $cursor ORDER BY id`, maps each row to
   a channel + version, and pushes a nudge to subscribed SSE clients.
3. **Connect/resume.** The server subscribes the connection to live events
   first; the client then refetches every authoritative query for those
   channels before treating the stream as ready. `Last-Event-ID` replay can
   reduce redundant work but never replaces that refetch. The chart refetches
   its snapshot and resumes from its domain sequence.
4. **Prune by age, never consumption.** `change_feed` is an invalidation log,
   not a queue with one consumer. A scheduled, observable retention job deletes
   rows older than 24–48h in bounded batches (or drops time partitions). The
   existing `created_at` index serves this. Retention must be deployed with the
   producer; otherwise the current implementation grows forever. No client
   acknowledgement controls deletion.

### Mapping, routing, and completeness

A UI slice is composed from several tables (the market header alone reads
`markets`, `market_metadata`, `market_ai_reviews`, `graduation_finalized_events`,
a matched-cap computed from `receipt_placed_events`, …). We do **not** map a
table to a component. Two indirections keep this tractable and hard to get
wrong:

- **Route by entity, not by component.** The writer explicitly records the
  affected market and, where relevant, the holder, so routing to
  `market:{chainId}:{marketId}` and/or `portfolio:{owner}` needs no inference.
  Deferred routing that a seam will do in TypeScript when its slice lands:
  pool/token writers look up their market before recording; a two-party transfer
  records one row per owner. The client maps each channel to the React Query keys
  to invalidate. Multi-table composition stays in the REST read.
- **Completeness lives at the write seam.** Production code does not insert a
  viewer-facing raw event or mutate a live projection directly; it calls a
  persistence module that records both authoritative state and semantic live
  changes through one transaction. Contract tests cover every production write
  path and every subscribed query key. This is stronger than proving a trigger
  registry is self-consistent against a fabricated fully populated row.

Because connect/reconnect always refetches authoritative state, duplicate,
out-of-order, skipped, or pruned invalidations cannot leave the UI permanently
stale. The live feed is a latency mechanism; the REST snapshot is the recovery
mechanism.

### The one data-in-message surface: price and chart

The price chart is the single place where signal-to-refetch is genuinely
wasteful, and the only surface that really wants "real time." It is an
**append-mostly time series**: each pregrad `ReceiptPlaced` (or postgrad
`pool_price_ticks` row) adds *one* point, but a refetch re-pulls the entire
history and re-replays the LMSR path — O(history) work for O(1) new
information — and a chart is naturally incremental in the client. So the
price/chart channel **pushes the datum**: `{ t, yesPrice, noPrice, sequence }`,
which the client appends. The headline YES/NO price numbers and the graduation
matched-cap are derived from the *same* trade, so they ride along in that one
message for free — one push updates the number, the bar, and the chart point.

This is the exchange snapshot+delta idea applied only where it earns its keep,
with the same safety net: each point carries a monotonic `sequence`; on a gap
(received `sequence` ≠ last + 1) or reconnect, the client does exactly one full
chart refetch to resync. Steady state is incremental; the fallback is a
plain REST read. Everything else in the app is discrete and refetch-shaped, so
it stays signal-to-refetch. The **order book ladder** is the most likely
*second* data-in-message channel if postgrad volume ever grows, but it is
bounded (top-N levels) and cheap to refetch, so it launches as signal-to-refetch
and is not a day-one exception.

### Why not a message broker (SQS / RabbitMQ / Kafka / Redis)

A broker is the classic answer to "atomically update the DB and publish an
event" — but the transactional outbox already solves that dual-write problem
*without* one (the event is written to the DB in the same transaction, then
relayed). A broker's dividends — durable fan-out to **multiple independent
consumer systems**, cross-service decoupling, and throughput beyond what one
Postgres can tail — are dividends we don't collect here: there is exactly one
consumer (the SSE relay in the API) reading one indexed table, and the outbox
already provides the durability, ordering, and replay a broker would. A broker
also would not remove the API from the path — it still must hold the browsers'
SSE connections and translate broker messages into channel pushes — so it would
be added weight, not a simplification. If we ever *do* outgrow a single-Postgres
tail (many API instances, or a genuine firehose), the first upgrade is Redis
Streams or logical-decoding/CDC feeding the same relay — still not a
general-purpose broker, and explicitly deferred until a second consumer or a
measured bottleneck exists.

### Waking the relay is a swappable detail

The relay may be woken by **polling** `change_feed` on a short interval
(~100–250ms; one cheap indexed range scan, works through RDS Proxy, zero
`NOTIFY`) or by a **coalesced `NOTIFY`** doorbell (one per committed indexer
batch, never per event, so the commit-serialization lock is never stressed).
Both give identical correctness because the outbox is the source of truth;
the choice only trades latency for idle efficiency and can change at any time
with no schema or client impact. **We ship polling first** and add coalesced
`NOTIFY` only if sub-250ms latency is wanted.

### Scope boundaries

- Per [ADR 0007](0007-track-verticals-with-progress-adrs.md), deployment is
  out of scope here and belongs to
  [ADR 0015](0015-deployment-and-infrastructure.md): the SSE route behind the
  ALB, cross-origin CORS for the Vercel app origin, and (if coalesced `NOTIFY`
  is ever adopted) a session-mode DB connection bypassing RDS Proxy.
- Confirmation-depth and reorg semantics for *when* an event is safe to emit
  belong to [ADR 0010](0010-indexer-maturity.md). Emitting at ingestion is
  fine for local dev and launch; the signal-to-refetch model degrades
  gracefully because a reorg simply re-emits and the client refetches
  corrected state.

## Implementation slices (each its own PR)

- [x] **Outbox + relay + SSE endpoint (server spine).** PR #249. The
      `change_feed` table + migration; the poll-based relay + in-process hub with
      lookback/dedup for the sequence-visibility gap; a `GET /events` SSE route
      honouring `Last-Event-ID` (best-effort) with subscribe-then-replay-then-live
      handshake; and always-on age-based (~48h) pruning started with the API.
      Emit is an explicit `recordLiveChange(tx, …)` at each write seam (no DB
      trigger), covering the market-keyed sources plus the AI-review/resolution
      runners, with a coverage test enforcing completeness. `Last-Event-ID` replay
      is a best-effort latency optimization; correctness is the client's
      subscribe-then-refetch on every connect/reconnect. Deferred to the surface
      slices: pool/token-keyed routing (price/chart, order book, transfers) and
      the job-queue UPDATE progress; a txid low-watermark cursor to close the
      below-cursor replay gap is deferred hardening.
- [ ] **Client transport layer.** One shared `EventSource` in a top-level
      provider (never per-component); a `useLiveChannel(channel)` hook that
      subscribes/unsubscribes on mount/route change; messages call
      `queryClient.invalidateQueries({ queryKey })`; `staleTime` raised since
      the server now owns freshness; pause on tab-hidden (Page Visibility);
      jittered reconnect backoff; dedup/ordering by the `id` field.
- [ ] **Pregrad live surfaces (biggest gap).** Put discovery and pregrad
      market-detail on live channels so any trader's `ReceiptPlaced` updates
      them for all viewers, replacing the own-trade-only `router.refresh()`.
      The **price/chart channel is data-in-message** (push
      `{ t, yesPrice, noPrice, sequence }`; the client appends the point and
      updates the headline number + graduation bar from the same message, with
      a full chart refetch as the gap/reconnect resync). Everything else on the
      page (status, review, volume/receipt counts) stays signal-to-refetch.
- [ ] **Convert the three existing polls to push.** Order book (5s), open
      venue orders (8s), and portfolio (15s) subscribe to their channels and
      refetch on signal; keep a slow poll only as a backstop.
- [ ] **Lifecycle + AI review.** Toasts / list insert-remove on create,
      graduate, resolve, cancel; replace the 2s full-page AI-review refresh
      with a targeted review-progress channel; surface the clearing
      challenge-window countdown (sourced from `clearing_root_submitted_events`,
      invisible to a status-only feed).
- [ ] **Hardening / efficiency (as needed).** Finer-grained REST slices where
      refetch is heavy (per-market portfolio slice, a standalone current-price
      endpoint, `since`/cursor on `/receipts` and `/orders`); optional
      Coinbase-style scoped-value payloads for the single hottest surface;
      optional partitioning after bounded time-based pruning is measured;
      optional coalesced `NOTIFY` doorbell.
- [ ] **E2E coverage.** Extend the chain e2e lane so a second actor's trade
      moves a first actor's open market page, and a graduation/resolution
      surfaces live, without a reload.

## Exit criteria

A user sitting on the discovery page, a market page, or their portfolio sees
prices, the graduation bar, order book, positions, and lifecycle transitions
update in place — driven by *other* actors and by chain events — without a
manual refresh; a dropped/reconnected client refetches authoritative state
after subscribing and cannot remain stale even when an invalidation was missed
or pruned; and the indexer remains a pure chain→DB process with no dependency
on the API.

## Consequences

- **Postgres gains a semantic outbox write in every viewer-facing transaction**
  and a relay tail read. Failure is intentionally atomic with the authoritative
  write and must be covered by write-path contract tests. A mandatory retention
  job prevents unbounded growth.
- **Correctness lives in subscribe-then-refetch, not cursor replay.** The wake
  mechanism (poll vs. `NOTIFY`), retention horizon, cursor optimization, and
  transport can change without making a reconnecting client stale.
- **Live semantics are explicit application contracts.** Adding a viewer-facing
  write means naming its registered source and passing its routing/version
  columns at the persistence seam, in TypeScript—not a physical-table trigger
  outside the application transaction. The typed `sourceTable` and the coverage
  test make a missing or unregistered seam a build failure.
- **This program leans on two open items in other ADRs**: finer-grained
  read endpoints (this ADR, hardening slice) and confirmation-depth/reorg
  emit timing (ADR 0010). Neither blocks launch of the core loop; both should
  be revisited before the public network sees high event rates.
- **Multi-instance fan-out needs no new infra yet.** Each autoscaled API
  instance tails the same `change_feed` and pushes to its own SSE clients;
  Redis (pub/sub or Streams) is only warranted if that tail or the connection
  count outgrows a single Postgres — explicitly deferred.
