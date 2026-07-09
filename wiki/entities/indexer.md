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
updated: 2026-07-08
---

# Indexer

`server/src/indexer/` — pure chain ingestion. Watches all nine
[PregradManager](pregrad-manager.md) event types (creation, review, receipt,
settlement — including `GraduationStarted`, `ClearingRootSubmitted`,
`GraduationFinalized`, `MarketRefundsAvailable`) with idempotent cursor-based
recovery (dedupe on tx hash + log index). Verifies the canonical JSON
metadata hash from `MarketCreated` and persists `market_metadata`.

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

## Open maturity work ([root ADR 0010](../summaries/root-adr-0010-indexer-maturity.md))

Reorg handling (block hashes + rewind), configurable confirmation depth, RPC
failover, DB-backed leasing, cursor-lag metrics remain open. Balance
projections raise the stakes on reorg handling: an orphaned Transfer leaves a
wrong balance, not just a stale log row.

## Related pages

- [Server workspace](server-workspace.md) — hosts it
- [Market lifecycle](../concepts/market-lifecycle.md) — the projection semantics
- [Postgrad v4 venue](postgrad-v4-venue.md) — the event surface it must learn
