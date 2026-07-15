---
type: summary
title: Portfolio data design
description: DB-backed Portfolio spec — Transfer-event balance indexing, one aggregate owner endpoint, receipt→settlement join, current-value-not-PnL v1; also carries the repo-wide money-paper-trail invariant.
sources:
  - docs/portfolio-data-design.md
updated: 2026-07-15
---

# Portfolio data design (docs/portfolio-data-design.md)

Status: **Implemented** (phases 1-5 landed 2026-07-09 as PRs #151-#154; the
PnL follow-up, phase 6, remains open). Replaces the localStorage-stub Portfolio page
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

## Invariant: persist a money paper trail (added 2026-07-13)

This doc is now the home of a **repo-wide hard rule**, promoted into `AGENTS.md`
so every agent session inherits it:

> Every value transfer MUST leave an immutable, receipt-linked DB record sourced
> from an on-chain event — never inferred, never dropped.

It binds every money-touching feature: graduation clearing, refunds,
cancellation, resolution redemption, and postgrad trades. Today it is realized by
append-only event tables mirrored 1:1 from chain:

- `graduated_receipt_claimed_events` — per receipt: `retainedShares`,
  `retainedCost`, and the **partial** refund. The record that a graduated receipt
  was filled, and by how much.
- `refunded_receipt_claimed_events` — per receipt: the **full** refund on a
  refunded (missed-deadline) or [cancelled](protocol-adr-0011-admin-market-cancellation.md)
  market.
- `market_refunds_available_events` / `market_cancelled_events` — the
  market-level events that open refunds.
- `postgrad_redemption_events` *(added 2026-07-14 with the claim-winnings UI)* —
  per redemption on a resolved/cancelled postgrad market: winning-side tokens
  (or YES+NO draw legs) burned and the **collateral paid out**, from the
  market's `Redeemed`/`CancelledRedeemed` events. The token-burn leg of the
  same transaction also lands in `outcome_token_transfer_events`; this table
  records the collateral leg.

The subtle part: because refunds are **pull-based**, a per-receipt record appears
when money actually *moves* (the claim), not when it becomes *owed*. That is
deliberate — the owed amount is always recoverable from chain (receipt cost plus
the clearing root), so the DB trail is "money that moved", which is the correct
thing to persist. A single canonical per-receipt settlement row (owed + paid +
claimed-at) may be materialized later as a **projection over** these event
tables; the events stay the source of truth.

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
  (new `server/src/api/routes/portfolio.ts`). *Extended 2026-07-15:* the
  payload also carries `redemptions` — past `Redeemed`/`CancelledRedeemed`
  payouts read from `postgrad_redemption_events` as `PortfolioRedemption`
  (burned token legs, raw `collateralAmount`, decimals-reconciled `valueWad`).
  A redeemed position's balance row zeroes out and leaves the positions list,
  so this history (the portfolio page's "Claimed payouts" table) is the only
  surface where the payout stays visible — the resolution counterpart of a
  receipt's `settled` state.
- **D3 — wallet identity = lowercased query param**, validated
  `^0x[0-9a-f]{40}$`, no auth; same pattern as `orders?owner=`.
- **D4 — client transport:** visibility-aware polling hook
  (`use-portfolio.ts`) fetching the **same-origin proxy** route
  `/api/indexer/portfolio` (like `use-order-book.ts`), so the indexer base URL
  stays server-side. Explicitly no react-query. *(A 2026-07-08 draft wrongly
  switched this to a direct browser read via
  `NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL`, believing the orderbook proxy was
  dead code; it is not, and local dev never sets the browser var, so the page
  never loaded. Reverted to the proxy in PR #159.)*
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
2. Server read model (portfolio models/service/route) — **landed as PR #152**
   together with phase 3.
3. OpenAPI + orval client regen (same PR as 2, per server-openapi-sync).
4. App polling hook — **landed as PR #153** (shipped reading the browser var
   directly; fixed to use the same-origin proxy in PR #159, D4).
5. UI rewire of `portfolio-page.tsx` (localStorage path dropped — DB only;
   the smoke e2e now asserts the connect-wallet state) — **landed as PR #154**.
6. Follow-up: PnL (swap cost capture + lot accounting) — open.

## Related pages

- [Indexer](../entities/indexer.md) — hosts the Transfer watcher
- [Server workspace](../entities/server-workspace.md) — the portfolio endpoint
- [App workspace](../entities/app-workspace.md) — the page being rebuilt
- [Postgrad v4 venue](../entities/postgrad-v4-venue.md) — where held tokens go when orders rest
- [Market lifecycle](../concepts/market-lifecycle.md) — the receipt states rendered
