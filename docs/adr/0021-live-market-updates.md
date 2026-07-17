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

Four decisions, with the alternatives we rejected:

| Axis | Decision | Rejected |
| --- | --- | --- |
| **Payload** | **Signal-to-refetch by default**: the message carries the changed entity's channel + a version; the client invalidates its React Query key and refetches the existing REST slice (multi-table composition stays server-side). **One data-in-message exception, from day one — the price/chart channel** (see below), which pushes the new point itself. | Additive delta streaming *everywhere* (exchange-style book reconstruction, checksums, resync) — unjustified at our cadence outside the append-mostly chart. |
| **Transport** | SSE on the long-running Bun/Elysia API. | WebSocket — we have no client→server stream (trades already POST); SSE gives auto-reconnect + `Last-Event-ID` resume + sequence ids for free. Kept in reserve for a future bidirectional need. Hosting on Vercel — its functions force-close at the duration cap with no reconnect affinity. |
| **Emit point** | A durable `change_feed` outbox table, written **in the same transaction** as each event by an `AFTER INSERT` trigger on the append-only tables. | In-indexer emit (can't cross processes; misses the AI-review runner's and keeper's writes). A trigger is writer-agnostic and fires only on committed rows, auto-suppressing the `MarketNotIndexedError` rollback path. |
| **Delivery guarantee** | The **outbox table + a per-client cursor** (`Last-Event-ID`). | A message broker (SQS/RabbitMQ/Kafka) — duplicates what the outbox already provides, adds infra, and still cannot hold the browsers' SSE connections. `NOTIFY` as the guarantee — it has none. |

### The change-feed outbox

`change_feed` is an append-only "something changed" log, written atomically
with the data change so the two can never disagree:

```
change_feed(
  id            bigserial primary key,   -- monotonic cursor == SSE Last-Event-ID
  created_at    timestamptz not null default now(),
  source_table  text    not null,        -- e.g. 'receipt_placed_events'
  row_id        bigint  not null,        -- PK of the changed row
  chain_id      integer not null,
  market_id     numeric,                 -- routes to channel  market:{chainId}:{marketId}
  owner         text,                    -- routes to channel  portfolio:{owner}
  block_number  bigint,  log_index integer  -- version, for client dedup/ordering
)
```

1. **Write (atomic).** A single generic trigger function copies raw provenance
   into one `change_feed` row in the *same* transaction as the change. It is
   attached `AFTER INSERT` on the append-only tables that carry viewer-facing
   changes (the `*_events` set plus `market_ai_reviews` and
   `market_resolutions`), and `AFTER UPDATE` on the few mutable projections
   whose in-place transitions are themselves the signal (notably
   `market_ai_review_jobs` queue state — `queued→running→complete` — which is
   what the current 2s full-page AI-review refresh reflects). If the change
   commits, the feed row commits; if it rolls back, so does the feed row. The
   trigger stays dumb — the mapping from `source_table` to SSE channel and
   React Query key lives in TypeScript in the relay, not in PL/pgSQL, so it is
   testable and versioned with the app.
2. **Relay.** The API keeps a cursor, reads
   `SELECT … FROM change_feed WHERE id > $cursor ORDER BY id`, maps each row to
   a channel + version, and pushes a nudge to subscribed SSE clients.
3. **Resume.** On reconnect the browser sends `Last-Event-ID` = the last
   `change_feed.id` it saw; the relay replays `WHERE id > that` for the
   client's channels. This — not `NOTIFY` — is the delivery guarantee.
4. **Prune.** `change_feed` is a log; retention is ~24–48h (delete or
   partition-drop). A client offline past the window simply does a normal cold
   refetch.

### Mapping, routing, and completeness

A UI slice is composed from several tables (the market header alone reads
`markets`, `market_metadata`, `market_ai_reviews`, `graduation_finalized_events`,
a matched-cap computed from `receipt_placed_events`, …). We do **not** map a
table to a component. Two indirections keep this tractable and hard to get
wrong:

- **Route by entity, not by component.** The trigger extracts `market_id` and
  `owner` from the changed row, so every `change_feed` row already names its
  entity — routing to `market:{chainId}:{marketId}` and/or `portfolio:{owner}`
  is a direct field read, no join, no inference. The relay maps
  `source_table → channel(s)`; the client maps `channel → the React Query keys
  to invalidate`. The multi-table *composition* stays where it already lives —
  in the REST read, recomputed fresh on refetch. The signal only ever says
  "entity X changed; re-read it," so we never decompose a slice into its tables.
- **Completeness is an enumerable set, not per-wiring diligence.** "Did we drop
  something?" reduces to one auditable question: *is this table in the trigger
  set?* The invariant we lean on (verified in the write-path) is that every
  meaningful projection mutation is coupled to an append in the same
  transaction, so triggering the append-only tables (plus the handful of
  mutable projections whose UPDATE *is* the signal) catches every viewer-facing
  change exactly once — and, deliberately, we do **not** also trigger `markets`
  UPDATEs, which would double-signal what the coupled event row already covers.
  The `source_table → channel → query-key` map is a single TypeScript registry,
  and a **coverage test** enforces both directions: every triggered table maps
  to ≥1 channel, and every React Query key a page subscribes to is reachable
  from some channel that page subscribes to. Adding a new indexed table is a
  visible checklist item ("route it in the change-feed map"), caught in review
  and by the test — not a silent omission.

Because a signal triggers a whole-slice refetch of authoritative state,
duplicate, out-of-order, or replayed-after-reconnect signals cannot corrupt or
drop anything — worst case is a redundant refetch. The only true drop risk is a
table missing from the trigger set, which the coverage test exists to catch.

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

- [ ] **Outbox + relay + SSE endpoint (server spine).** The `change_feed`
      table and migration; the generic `AFTER INSERT` trigger applied to the
      append-only tables; the relay (poll-based) with the `source_table →
      channel + React Query key` map in TypeScript; a `GET /events` SSE route
      on the API that honours `Last-Event-ID` and filters by subscribed
      channel. Unit tests: trigger fires once per committed row and not on
      rollback; relay maps and orders correctly; resume replays exactly the
      gap. Handle the Postgres sequence-visibility gap explicitly (small
      lookback re-read + client dedup by `id`).
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
      `change_feed` retention/partitioning; optional coalesced `NOTIFY`
      doorbell.
- [ ] **E2E coverage.** Extend the chain e2e lane so a second actor's trade
      moves a first actor's open market page, and a graduation/resolution
      surfaces live, without a reload.

## Exit criteria

A user sitting on the discovery page, a market page, or their portfolio sees
prices, the graduation bar, order book, positions, and lifecycle transitions
update in place — driven by *other* actors and by chain events — without a
manual refresh; a dropped/reconnected client recovers every missed update via
`Last-Event-ID` replay; and the indexer remains a pure chain→DB process with
no dependency on the API.

## Consequences

- **Postgres gains a new write on every indexed event** (the `change_feed`
  row via trigger) and a new read pattern (the relay tail). Both are cheap,
  but `change_feed` growth must be pruned/partitioned, and the trigger is now
  part of the indexer's write path — a failure there fails the event
  transaction (which is the correct, atomic behaviour, but must be covered by
  tests).
- **The delivery guarantee lives in the table, not the transport**, so the
  wake mechanism (poll vs. `NOTIFY`) and even the transport can change later
  without touching correctness — a deliberate hedge against the RDS-Proxy and
  NOTIFY-lock constraints.
- **The append-only tables become a public-ish change contract.** Adding a new
  indexed event type means deciding whether it feeds `change_feed`; the
  `source_table → channel` map is the single place that decision is recorded.
- **This program leans on two open items in other ADRs**: finer-grained
  read endpoints (this ADR, hardening slice) and confirmation-depth/reorg
  emit timing (ADR 0010). Neither blocks launch of the core loop; both should
  be revisited before the public network sees high event rates.
- **Multi-instance fan-out needs no new infra yet.** Each autoscaled API
  instance tails the same `change_feed` and pushes to its own SSE clients;
  Redis (pub/sub or Streams) is only warranted if that tail or the connection
  count outgrows a single Postgres — explicitly deferred.
