---
type: entity
title: Indexer
description: viem-based chain ingestion — watches all PregradManager events into raw rows plus rebuildable market projections; singleton by design, Arc-grade maturity still open.
sources:
  - server/README.md
  - docs/adr/0010-indexer-maturity.md
  - docs/ai-review-runner-design.md
  - protocol/docs/postgrad-contract-metadata.md
  - docs/portfolio-data-design.md
  - infra/README.md
  - protocol/docs/adr/0012-use-a-singleton-postgrad-position-book.md
updated: 2026-07-29
---

# Indexer

`server/src/indexer/` — pure chain ingestion. Watches all eleven
[PregradManager](pregrad-manager.md) event types (creation, review, receipt,
settlement — including `GraduationStarted`, `ClearingRootSubmitted`,
`GraduationFinalized`, `MarketRefundsAvailable`, the two receipt-claim events,
and `MarketCancelled` from the
[moderation kill switch](../summaries/protocol-adr-0011-admin-market-cancellation.md))
with idempotent cursor-based recovery (dedupe on tx hash + log index). Verifies
the canonical JSON metadata hash from `MarketCreated` and persists
`market_metadata`.

The claim and cancellation events are not incidental: they are the
**[money paper trail](../summaries/portfolio-data-design.md)** — every value
transfer must leave an immutable, receipt-linked DB row sourced from an on-chain
event, never inferred. `graduated_receipt_claimed_events`,
`refunded_receipt_claimed_events`, `market_refunds_available_events`, and
`market_cancelled_events` are append-only mirrors of chain, and any settlement
view is a projection *over* them.

## Design constraints

- Never calls models, web, or moderation policy; must never be blocked on
  model latency ([AI review](ai-review-service.md) owns that).
- New markets project as `under_review`; the chain review watcher moves them
  (`MarketReviewApproved`→`bootstrap`, `MarketReviewRejected`→`rejected`) —
  runner verdicts and chain events are two valid inputs to the same
  projection, deconflicted by guarded updates keyed on status + metadata_hash.
- Projection tables must stay rebuildable from raw event tables; the postgrad
  address registry must discover addresses from `GraduationFinalized` /
  `PostgradMarketPrepared` events, not static config. The full event-first
  reconstruction path (adapter event → token addresses → recomputed PoolIds →
  order/hook events) is specified in
  [postgrad contract metadata](../summaries/protocol-postgrad-contract-metadata.md).
- Runs as a singleton (writes are idempotent but multiple watchers duplicate
  RPC work and race the cursor); health file `/tmp/popcharts-indexer-healthy`;
  RPC via WSS from Secrets Manager.

## Postgrad coverage (closing)

Graduated markets no longer fully "go dark": the
`BoundedPoolOrderManager` maker-order lifecycle indexes into
`venue_order_events`/`venue_orders` (+ derived `venue_pools` mapping), and the
[portfolio data design](../summaries/portfolio-data-design.md) adds a
**dynamic-address ERC-20 `Transfer` watcher** over each graduated market's
outcome tokens (landed, PR #151): tokens discovered from `venue_pools`, one
cursor per token address, late discoveries backfilled from their market's
graduation block, live subscription rebuilt on a discovery interval. It
projects per-wallet `outcome_token_balances`; raw v4 `Swap` events remain
deliberately unindexed (every swap surfaces as a Transfer).

The dynamic-address machinery this requires is also the indexer's main scale
exposure: watcher address sets, cursors, and sweep groups grow with cumulative
graduations. [Protocol ADR 0012](../summaries/protocol-adr-0012-singleton-postgrad-position-book.md)
(proposed) would bound this at the protocol — all postgrad money events from
one singleton position book, leaving only wrapper ERC20 `Transfer` tracking
dynamic, with terminal markets going quiet and prunable.

## Open maturity work ([root ADR 0010](../summaries/root-adr-0010-indexer-maturity.md))

Reorg handling (block hashes + rewind), configurable confirmation depth, RPC
failover, DB-backed leasing, cursor-lag metrics remain open. Balance
projections raise the stakes on reorg handling: an orphaned Transfer leaves a
wrong balance, not just a stale log row.

## Live-updates emit seam (built 2026-07-22, [root ADR 0021](../summaries/root-adr-0021-live-market-updates.md))

Live browser updates do **not** break the indexer's purity: each handler calls
`recordLiveChange(tx, …)`, writing one `change_feed` outbox row in the *same
transaction* as the event, which the API (a separate process) tails and fans out
over SSE. The indexer keeps writing only its own DB rows — no network calls, no
held connections, no dependency on the API. Emitting in-transaction makes it
transactional (a rolled-back event — e.g. the `MarketNotIndexedError` retry path
— produces no phantom signal). The writer-agnostic completeness a DB trigger
would give for free is instead recovered by a typed `sourceTable` + a coverage
test that scans the seam dirs (the same `recordLiveChange` seam also lives in the
two off-chain runners that append `market_ai_reviews` / `market_resolutions`,
which an in-indexer-only emit would miss).

## Operator alert seam (built 2026-07-24, [root ADR 0024](../summaries/root-adr-0024-resolution-dispute-program.md))

Two indexer conditions are operator pages rather than background writes. Each
writes a marker-prefixed record to stderr, and the
[infra](../summaries/infra-readme.md) stack keys one CloudWatch metric filter
and alarm per event term. The server is the master of the marker terms; the
alarms hold an intentional duplicate (`infra/` imports no workspace source),
pinned by an infra assertion test that builds each record with the server's
formatter.

**Resolution disputed** — a user staked a bond asserting the resolver got a
market wrong, and the market is frozen until a human settles it. The record
carries chain, market, disputer, bond, and transaction hash. It is raised
*after* the row commits and only when the insert actually landed, so a
rolled-back write cannot page and a recovery replay cannot page twice.

**Market status out of order** — a status-projecting event reached a market in
a status the transition accepts as neither predecessor nor already-past. The
record carries chain, market, the current and target statuses, the predecessors
that would have been accepted, and the block/log/transaction to replay. Its
commit rule is the *opposite* of the dispute page: it is raised inside the
transaction that is about to roll back, because there the rollback is the
incident and no committed row will record any of it.

The page matters because the throw is blunter than one stalled event. It
unwinds out of the watcher's per-log loop and its loop over contract groups,
abandoning the rest of that sweep, and the next discovery tick re-fetches the
same log and faults again — nothing self-clears. How far it spreads is set by
the cursor grouping: contracts are grouped by shared watermark, so in steady
state one market takes the whole pass with it, while once cursors diverge the
groups split and only the faulting contract's group stays wedged. Floor is one
cursor group, ceiling is every contract that watcher follows — and it stops
there, because each watcher is its own closure, interval and cursor name, so
the venue-order, pool-tick and token-transfer watchers keep indexing the same
markets throughout. Live delivery is the other exception — `onLogs` catches per
log, so a fault there is skipped rather than fatal, but it never moves a
watermark, so the sweep hits the same wall. Nothing crashes and nothing is
lost, which is exactly why the stall would otherwise be invisible. The record
repeats each tick, holding the alarm in ALARM rather than lapsing back to OK.

## Related pages

- [Server workspace](server-workspace.md) — hosts it
- [Market lifecycle](../concepts/market-lifecycle.md) — the projection semantics
- [Postgrad v4 venue](postgrad-v4-venue.md) — the event surface it must learn
- [Live market updates (ADR 0021)](../summaries/root-adr-0021-live-market-updates.md) — the change_feed emit seam
