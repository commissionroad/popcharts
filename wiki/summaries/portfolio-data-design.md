---
type: summary
title: Portfolio data design
description: DB-backed Portfolio spec — Transfer-event balance indexing, one aggregate owner endpoint, receipt→settlement join, current-value-not-PnL v1.
sources:
  - docs/portfolio-data-design.md
updated: 2026-07-08
---

# Portfolio data design (docs/portfolio-data-design.md)

Status: Proposed (2026-07-08). Replaces the localStorage-stub Portfolio page
with a database-backed view of a wallet's full lifecycle: pre-graduation
receipts, each receipt's settlement result at graduation, and live
post-graduation YES/NO positions plus open venue limit orders.

## The problem

The page reads receipts from browser localStorage (per-device, mixes mock and
real), hardcodes "Backed positions" to `0`, and shows nothing for graduated
markets — while the backend already indexes receipts, the settlement
lifecycle, and venue orders, all owner-keyed. The `(chainId, owner, receiptId)`
join between `receipt_placed_events` and the claim-event tables exists in the
DB and is surfaced nowhere.

## Key decisions

- **D1 — balances live in the DB.** Index each graduated market's
  outcome-token ERC-20 `Transfer` events (append-only
  `outcome_token_transfer_events` + mutable `outcome_token_balances`
  projection). One Transfer stream covers claim mints, v4 pool swaps,
  order pulls/fills, and plain transfers, so no v4 `Swap` indexing is needed;
  the portfolio becomes queryable for any address, not just a connected
  wallet. The watcher's address set is dynamic (seeded from `venue_pools`,
  grows at graduation).
  - **Held vs. committed:** resting a venue limit order pulls the maker's
    input tokens into the v4 pool manager, so wallet balance understates
    ownership. Owned = held (`outcome_token_balances`) + committed in the
    wallet's own open `venue_orders` (sells only — buys commit collateral).
  - Settlement events remain the source of *provenance* (what each receipt
    became), not current balance.
- **D2 — one aggregate endpoint.** `GET /portfolio/:chainId?owner=0x...`
  returning receipts + positions + open orders + summary in one payload
  (new `server/src/api/routes/portfolio.ts`).
- **D3 — wallet identity = lowercased query param**, validated
  `^0x[0-9a-f]{40}$`, no auth; same pattern as `orders?owner=`.
- **D4 — client transport:** same-origin proxy route + visibility-aware
  polling hook (`use-portfolio.ts`), explicitly no react-query.
- **D5 — three value tiers.** v1 ships tier 2, **current value** =
  owned quantity × live pool price (reusing the order-book path's
  `sqrtPriceX96` read); tier 3 **true PnL is deferred** because per-swap cost
  is not indexed (Transfer gives quantities, not collateral paid) — closing it
  needs transfer-leg pairing per swap tx plus lot accounting. Watch the
  6-decimal collateral vs 18-decimal outcome-token scaling in value math.

## Receipt status subtlety

A market can be `graduated` while a receipt is unclaimed
(`claimGraduatedReceipt` is per-receipt, user-triggered). Status must key off
market status *and* claim-row presence — "graduated, unclaimed" is distinct
from "settled" and from "refunded" (refund-only markets settle via
`refunded_receipt_claimed_events`).

## Implementation phases

1. Balances indexer (dynamic-address Transfer watcher + two tables) —
   **landed as PR #151**, including a drizzle migration that also caught up
   the venue_* tables (which had shipped without one).
2. Server read model (portfolio models/service/route).
3. OpenAPI + orval client regen (same PR as 2, per server-openapi-sync).
4. App proxy route + polling hook.
5. UI rewire of `portfolio-page.tsx` (localStorage path dropped — DB only).
6. Follow-up: PnL (swap cost capture + lot accounting).

## Related pages

- [Indexer](../entities/indexer.md) — hosts the Transfer watcher
- [Server workspace](../entities/server-workspace.md) — the portfolio endpoint
- [App workspace](../entities/app-workspace.md) — the page being rebuilt
- [Postgrad v4 venue](../entities/postgrad-v4-venue.md) — where held tokens go when orders rest
- [Market lifecycle](../concepts/market-lifecycle.md) — the receipt states rendered
