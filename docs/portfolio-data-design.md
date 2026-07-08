# Portfolio Data Design

Status: Proposed

Date: 2026-07-08

## Context

The Portfolio page (`app/src/features/portfolio/portfolio-page.tsx`) is a stub. It
reads pre-graduation receipts from **browser localStorage** (`useStoredReceipts`,
key `popcharts:placed-pregrad-receipts:v1`), computes locked collateral
client-side, and hardcodes the "Backed positions" metric to the literal `"0"`. It
never touches the API or the database, so:

- Receipts are per-browser. Clear storage or switch devices and they vanish.
- "Mock receipts" (placed without a real transaction) are shown alongside real
  ones with no way to tell whether anything actually landed on chain.
- There is **nothing** for graduated markets — no settled receipt results, no
  YES/NO outcome-token positions, no open limit orders on the venue pools.

Meanwhile the backend already indexes almost everything we need. The
`server/` package runs a custom viem indexer over Postgres (Drizzle ORM) and
serves a read API via Elysia; the frontend consumes it through the generated
`@popcharts/api-client`. The indexer already records placed receipts, the full
graduation/settlement lifecycle, and resting venue limit orders — all keyed by wallet
address. The data exists; **no owner-scoped endpoint exposes it, and the UI never
asks for it.**

This document specifies a database-backed Portfolio that covers a wallet's entire
lifecycle: pre-graduation receipts, the settlement result when a market
graduates, and live post-graduation YES/NO positions and open orders.

## Goals

- Source all portfolio data from the indexed database (via the read API), not
  from localStorage or ad-hoc client-side reconstruction.
- Show a connected wallet's **pre-graduation receipts** with real on-chain status
  (placed, awaiting graduation) — cross-market, cross-device.
- Show, when a market graduates, the **settlement result** of each receipt: how
  much collateral was retained into outcome tokens, how many tokens were minted,
  and how much collateral was refunded.
- Show a wallet's **post-graduation positions** (YES/NO holdings per graduated
  market) and **open venue limit orders**, aggregated across all markets.
- Follow the existing owner-scoped read pattern (query param, no auth) and the
  code-first OpenAPI → orval codegen pipeline.

## Non-Goals

- No user/account model or authentication. Portfolio is keyed by the connected
  wallet address, passed as a query parameter, exactly like the existing
  `orders?owner=` endpoint. Read-only public data; no signature required.
- No new on-chain contracts or changes to the clearing algorithm.
- No realized-PnL accounting or tax lots in v1. We surface cost basis where it is
  directly available from settlement data; full PnL is a follow-up (see Open
  Questions).
- No writes. Order placement and cancellation stay on the per-market ticket where
  they already live.

## The lifecycle we are modeling

A single receipt moves through four states. The Portfolio must render each:

1. **Placed (pre-graduation).** `placeReceipt` on `PregradManager` escrows
   collateral and emits `ReceiptPlaced(receiptId, marketId, owner, side, shares,
   cost, rLow, rHigh, sequence)`. `rLow`/`rHigh` are the LMSR price interval the
   buy swept — the receipt's price band. Indexed into `receipt_placed_events`
   (has `owner`).

2. **Graduating.** `startGraduation` → off-chain clearing → `submitClearingRoot`
   → challenge window → `finalizeGraduation`. The market `status` walks
   `bootstrap → graduating → graduated`. Clearing is computed off-chain and
   committed as a Merkle root; the contract only checks escrow conservation.

3. **Settled.** Per receipt, `claimGraduatedReceipt` mints outcome tokens and
   emits `GraduatedReceiptClaimed(receiptId, marketId, owner, side,
   retainedShares, retainedCost, refund)`. This is the **result of the receipt**:
   `retainedShares` = outcome tokens received, `retainedCost` = collateral
   converted (implied avg fill = `retainedCost / retainedShares`), `refund` =
   collateral returned. Indexed into `graduated_receipt_claimed_events`.
   Non-graduated markets refund instead via `refunded_receipt_claimed_events`.

4. **Holding / trading.** Outcome tokens are plain 18-decimal ERC-20s that trade
   against collateral in the market's **bounded Uniswap v4 venue pools** (Trueo
   style — a `poolManager` + bounded prediction `boundedHook` + `swapRouter`, not
   a CLOB). A market trade is a **v4 pool swap** (`VenueSwapQuote`: buys spend
   collateral for outcome tokens, sells the reverse). A wallet can also rest
   **limit orders**, which are bounded single-range v4 liquidity positions managed
   by `BoundedPoolOrderManager` (`venue_orders`, owner-indexed:
   `open`/`filled`/`cancelled`) — maker positions that takers swap against, not
   entries in a matching engine. The wallet's position changes both when its limit
   orders fill and when it swaps directly against the pool.

The join key between "placed" and "settled" is `(chainId, owner, receiptId)`,
present in both event tables. **That link already exists in the database and is
currently surfaced nowhere.**

## What exists vs. what we build

| Data | Where it lives today | Portfolio needs |
|---|---|---|
| Markets + status (grad/pre-grad) | `markets` + `market_metadata` (DB) | reuse |
| Pre-grad receipts per owner | `receipt_placed_events` (DB, has `owner`) — API exposes it **per-market only**, no owner filter | new owner-scoped query |
| Receipt settlement result | `graduated_receipt_claimed_events` / `refunded_receipt_claimed_events` (DB) | **no API at all** — new |
| Open venue limit orders (bounded v4 liquidity positions) | `venue_orders` (DB, owner-indexed); `GET .../:marketId/orders?owner=` exists but is single-market | new cross-market query |
| Post-graduation swaps (takers acquiring/exiting tokens) | **not indexed** as swaps — but every swap moves outcome tokens, so it surfaces as an ERC-20 `Transfer` | captured by the new `Transfer` watcher (D1) |
| Graduated pool → outcome token map | `venue_pools` (DB) | reuse for token addresses |
| Held YES/NO token balances | **on chain only** today (`balanceOf` via `useVenueBalances`); not in DB | **materialize in DB** — new `Transfer` watcher + balances table (D1) |
| User/account identity | none — keyed by lowercased `0x` address | none needed |
| Cost basis / PnL | not stored anywhere | derive partial from settlement |

## Key decisions

### D1. Store token balances in the DB by indexing outcome-token `Transfer` events

**Decision: materialize each wallet's YES/NO outcome-token balances in the
database from indexed ERC-20 `Transfer` events.** Token holdings must be stored and
lookup-able server-side, independent of a connected wallet — not read ad hoc from
chain `balanceOf`. This makes the portfolio queryable for any address (shareable /
server-rendered views, analytics, admin lookups) rather than only for the person
currently holding the keys.

Why `Transfer` indexing is the right source (verified against the contracts):

- `OutcomeToken` is a **standard OpenZeppelin ERC-20** (`protocol/contracts/postgrad/OutcomeToken.sol`).
  Its `mint`/`burnFrom` call OZ `_mint`/`_burn`, which emit `Transfer` to/from the
  zero address. So **every** balance change — the graduation-claim mint, v4 pool
  swaps, limit-order fills, plain transfers — surfaces as one `Transfer` event.
  Indexing that single event yields exact balances; we do not need to watch v4
  `Swap` events or reconstruct anything.
- Token addresses are already discovered at graduation and stored in
  `venue_pools.outcomeToken`, so the watcher knows which contracts to follow.

**Held vs. committed — the correctness boundary.** "Tokens a user owns" has two
parts once venue limit orders exist, and a naive balance gets this wrong:

- **Held** = tokens in the wallet. When a user places a resting limit order,
  `BoundedPoolOrderManager._settle` pulls the input token out of their wallet into
  the v4 pool manager (`tokenPuller.transferFrom(owner, …)`); it is returned on
  fill/cancel. So held balance (which `Transfer` indexing tracks exactly, since the
  pull *is* a Transfer) **drops** while an order rests. This is correct as "in
  wallet" but is not the user's full economic position.
- **Committed** = tokens locked in the user's own open orders. These sit
  commingled in the pool manager and cannot be attributed per-user from `Transfer`
  events alone — but they are already tracked per-user in `venue_orders`
  (`remainingLiquidity` / `amountIn`, only for orders whose input token is the
  outcome token, i.e. sells).

The two sources compose: **owned = held (balances table) + committed (`venue_orders`)**.
The portfolio surfaces both and can show them separately ("held" / "in open
orders") or summed. Settlement events (`graduated_receipt_claimed_events`) remain
the source for **provenance** — the receipt→position story (how many tokens each
receipt produced, and the refund) — but they are no longer the source of the
*current* balance; the balances table is.

New pieces this requires (detailed under Proposed data model / API):

1. A `Transfer` watcher over outcome-token contracts (dynamic address set, seeded
   from `venue_pools`), writing an append-only `outcome_token_transfer_events`
   table plus a mutable `outcome_token_balances` projection keyed by
   `(chainId, outcomeToken, owner)` — following the repo's existing
   events-table + projection pattern.
2. A portfolio positions query that reads held balance from
   `outcome_token_balances` and committed amounts from `venue_orders`.

This is more indexer work than reading `balanceOf` per connected wallet, but it is
what "store and be able to look up the tokens a user owns" requires, and it is the
only design that makes the portfolio correct for a non-connected address.

### D2. Endpoint shape: one aggregate portfolio endpoint

Add a single `GET /portfolio/:chainId?owner=0x...` returning a structured payload
(receipts, positions, open orders, summary) rather than three separate owner-scoped
endpoints the client must stitch. Rationale: the page renders them together, they
share the `owner` + market-metadata join, and one query keeps the wallet→data
fan-out server-side. Mount it in a new `server/src/api/routes/portfolio.ts` to keep
`markets.ts` focused.

### D3. Wallet identity: connected address as query param, no auth

Reuse the exact pattern of `getMarketVenueOrders`: lowercase the address, validate
`^0x[0-9a-f]{40}$`, return a `{ kind: "invalid_owner" }` union on bad input. The
connected wallet address comes from wagmi/Privy at runtime. Public read data;
consistent with every other owner-scoped read.

### D4. Fetch pattern: same-origin proxy route + client polling hook

Portfolio is per-connected-wallet and must live-update (orders fill, markets
graduate), so it is client-side, not an RSC. Follow the established client
transport:

- Add a proxy route `app/src/app/api/indexer/portfolio/route.ts` (copy
  `app/src/app/api/indexer/orderbook/route.ts`) so the indexer base URL stays
  server-side.
- Write `app/src/features/portfolio/use-portfolio.ts` as a `"use client"` hook in
  the `useEffect` + `useState` + visibility-aware polling style of
  `use-open-venue-orders.ts` / `use-order-book.ts`, keyed on the connected `owner`.
  Do **not** introduce react-query — it is not the house style for app data.

### D5. Cost basis in v1, PnL deferred

Settlement gives a real average fill per settled receipt
(`retainedCost / retainedShares`), so cost basis for graduation-derived positions
is cheap to show. Live mark-to-market PnL additionally needs the current pool price
(`displayPriceWad`) and — to attribute cost correctly after post-graduation
trading — a per-trade cost we do not compute (the `Transfer` index gives quantities,
not the collateral paid per swap). So v1 shows **quantity and cost basis**; a
"current value / PnL" column is a follow-up gated on a pool-price source plus
per-swap cost capture.

## Proposed data model (new tables)

Two new Drizzle tables in `server/src/db/schema/`, following the established
append-only-events + mutable-projection pattern (as `venue_order_events` +
`venue_orders` do). Addresses lowercased on insert; `uint256` via the existing
`numeric(78,0)` custom type.

- `outcome_token_transfer_events` — append-only source of truth, deduped on
  `(chainId, txHash, logIndex)`: `chainId`, `outcomeToken`, `from`, `to`, `value`
  (uint256), `blockNumber`, `blockTimestamp`, `txHash`, `logIndex`.
- `outcome_token_balances` — mutable projection, one row per
  `(chainId, outcomeToken, owner)`: `balance` (uint256), plus `marketId` / `side`
  denormalized from `venue_pools` for query convenience, and `updatedBlockNumber`.
  Each Transfer debits `from` and credits `to` (skipping the zero address on
  mint/burn). Indexed by `(chainId, owner)` for the portfolio lookup.

A new indexer watcher follows the outcome-token contract set. Unlike the current
watchers, the address set is **dynamic**: it is seeded from `venue_pools.outcomeToken`
and grows each time a market finalizes graduation. The watcher must register newly
discovered tokens (and backfill from their deploy block) as `GraduationFinalized` /
`venue_pools` rows appear.

## Proposed API

New route file `server/src/api/routes/portfolio.ts`, mounted in
`server/src/api/index.ts`.

```
GET /portfolio/:chainId?owner=0x...
  200 -> Portfolio
  400 -> string   (invalid owner / chainId)
```

TypeBox models in `server/src/api/models/portfolio.ts` (all bigints as strings,
dates ISO, mirroring `VenueOrderSchema` conventions), each with an `$id` so orval
emits named client models:

- `PortfolioReceipt` — `receiptId`, `marketId`, `marketQuestion`, `side`,
  `shares`, `cost`, `priceBandLow/High`, `status` (`awaiting_graduation` |
  `settled` | `refunded`), and, when present, the settlement:
  `retainedShares`, `retainedCost`, `refund`. This is the pre-grad row **and** its
  post-grad result in one object, joined from `receipt_placed_events` LEFT JOIN
  `graduated_receipt_claimed_events`/`refunded_receipt_claimed_events` on
  `(chainId, owner, receiptId)`.
- `PortfolioPosition` — per graduated market/side: `marketId`, `marketQuestion`,
  `side`, `outcomeToken`, `poolId`, and the ownership breakdown:
  `heldBalance` (from `outcome_token_balances`), `committedInOrders` (sum of the
  outcome-token input still locked in the wallet's open `venue_orders`), and
  `ownedTotal` (`held + committed`). Provenance fields `graduationShares` (sum of
  `retainedShares` from claims) and `avgCostWad` (derived from `retainedCost`) come
  from the settlement join. All computed **server-side** from the DB — no client
  `balanceOf` needed.
- `PortfolioOpenOrder` — a resting venue limit order (bounded v4 liquidity
  position): the existing `VenueOrder` shape plus `marketId` / `marketQuestion` for
  cross-market display; cross-market query over `venue_orders` filtered by `owner` +
  `status = open`.
- `PortfolioSummary` — `openReceiptCount`, `lockedCollateral` (sum of `cost` for
  `awaiting_graduation` receipts), `settledPositionCount`, `openOrderCount`. These
  replace the current hardcoded metric cards.

Service `server/src/api/services/portfolio.ts` runs the Drizzle joins, following
`getMarketVenueOrders` for owner validation and the `{ kind }` result union.

Regeneration workflow (unchanged, code-first): `bun run openapi:generate` in
`server/` → `pnpm --dir packages/api-client run api:generate` → commit
`server/generated/openapi.json` and the new generated client tree.

## Proposed UI

Rework `portfolio-page.tsx` into three sections fed by `use-portfolio.ts`,
gated on a connected wallet (empty state prompts connect):

1. **Summary cards** — replace the three hardcoded/stubbed cards with
   `PortfolioSummary`: open receipts, locked collateral, and a real backed/settled
   count (kills the literal `"0"`).
2. **Receipts** — the existing table, but each row's status now comes from the DB.
   Rows for graduated markets show their settlement result inline: "settled →
   N YES tokens, $X refunded" instead of the perpetual "Waiting for graduation."
3. **Positions & open orders** — new. Per graduated market: YES/NO quantity
   (held balance, tokens committed in open orders, and total), cost basis, and any
   resting orders with their fill progress. All from the DB. Links back to each
   market's ticket for trading/cancelling (writes stay there).

Design tokens from `src/design-system/tokens.css`; no raw hex. Product language
per `CONTEXT.md`: pre-graduation buys are receipts/priced intents, not fills.

## Implementation phases

1. **Balances indexer.** New `outcome_token_transfer_events` + `outcome_token_balances`
   schema and migration; a dynamic-address `Transfer` watcher seeded from
   `venue_pools` and extended on `GraduationFinalized`; backfill from each token's
   deploy block. Unit tests on the balance projection (mint/burn zero-address
   handling, debit/credit, dedupe, reorg/rollback of the projection). This is the
   load-bearing phase — everything downstream reads it.
2. **Server read model.** `portfolio.ts` models + service + route; owner-scoped
   Drizzle joins over `receipt_placed_events`, the settlement tables, `venue_orders`,
   `venue_pools`, `markets`, and the new `outcome_token_balances`. Unit tests
   (owner validation, receipt↔settlement join, held+committed aggregation,
   cross-market rollup).
3. **Codegen + client.** Regenerate OpenAPI + api-client; add wrapper method to
   `markets-api.ts` (or a new `portfolio-api.ts`) and a `domain/portfolio/queries.ts`
   with the env-driven base URL + fixtures fallback.
4. **Client hook + proxy route.** `use-portfolio.ts` + `api/indexer/portfolio/route.ts`
   in the visibility-aware polling style; keyed on an address (the connected wallet
   by default, but the endpoint works for any address).
5. **UI rewire.** Replace localStorage source in `portfolio-page.tsx`; add the
   positions/orders section; real summary cards; settled-receipt rendering.
   100% line coverage is enforced (`app/AGENTS.md`); include the unhappy paths
   (no wallet, empty portfolio, API error, market mid-graduation).
6. **(Follow-up) Value / PnL column.** Add a pool-price source and per-swap cost
   capture to turn held quantities into current value and realized/unrealized PnL.

## Risks and open questions

- **Held vs. committed (D1).** The single most likely source of "the number looks
  wrong": tokens a user has locked in their own open limit orders leave their
  wallet (pulled into the pool manager), so `heldBalance` alone understates what
  they own. The design counts `owned = held + committed`, but the UI must label the
  two clearly, and `committedInOrders` must only sum orders whose *input* token is
  the outcome token (sells) — a buy order commits collateral, not YES/NO tokens.
- **Balances-index correctness is now load-bearing.** Because positions come from
  the projection, any indexing gap makes balances silently wrong. Watch for: the
  dynamic address set (a token discovered late must be backfilled from its deploy
  block, or early transfers are lost); reorg handling (the projection must roll
  back with the events); and mint/burn (zero-address legs must not create a phantom
  `0x0` holder). A cheap invariant test: for each token, sum of all balances equals
  total minted minus burned; a periodic reconcile against on-chain `balanceOf` for
  a sample of holders catches drift.
- **Partial settlement / claim timing.** A market can be `graduated` while a
  receipt has not yet been claimed (`claimGraduatedReceipt` is per-receipt, often
  user-triggered). The receipt status must distinguish "graduated, unclaimed"
  (settlement row absent though market is graduated) from "settled" — otherwise a
  user sees "waiting" forever on a graduated market. The join must key off the
  market status *and* the presence of a claim row.
- **Refund-only markets.** `refunded`/`cancelled` markets settle via
  `refunded_receipt_claimed_events` (refund, no tokens). The receipt status enum
  must cover this path, not just graduation.
- **We index `Transfer`, not swaps.** Post-graduation trades are v4 pool swaps,
  which we deliberately do **not** watch as swaps; each swap still moves outcome
  tokens, so it is captured by the ERC-20 `Transfer` watcher. This keeps one code
  path (Transfer → balance) rather than reconciling swap deltas, and it also picks
  up limit-order fills and plain transfers for free. The trade-off is we get token
  *quantities* but not the collateral paid per swap — hence PnL is deferred (D5).
- **Multi-chain.** The endpoint is per `chainId`. If the app shows markets across
  chains simultaneously, the page must fan out per chain or the endpoint must
  accept multiple. v1 assumes single active chain (matches current usage); confirm.
- **Address source.** Uses the connected wagmi/Privy address. Smart-account or
  delegated setups where the receipt owner differs from the connected EOA are out
  of scope for v1.

## Files touched (reference)

- New (indexer/db): `server/src/db/schema/outcome-token-balances.ts` (events +
  balances tables, add to schema barrel), a Drizzle migration, and a `Transfer`
  watcher + handler under `server/src/indexer/watchers/` and `handlers/` with
  dynamic outcome-token discovery from `venue_pools`.
- New (api): `server/src/api/models/portfolio.ts`, `server/src/api/services/portfolio.ts`,
  `server/src/api/routes/portfolio.ts` (mount in `server/src/api/index.ts`).
- New (app): `app/src/domain/portfolio/queries.ts`,
  `app/src/features/portfolio/use-portfolio.ts`,
  `app/src/app/api/indexer/portfolio/route.ts`.
- Changed: `app/src/features/portfolio/portfolio-page.tsx` (off localStorage),
  `app/src/integrations/indexer/markets-api.ts` (wrapper method), regenerated
  `server/generated/openapi.json` + `packages/api-client/src/generated/**`.
- Reused: `receipt_placed_events`, `graduated_receipt_claimed_events`,
  `refunded_receipt_claimed_events`, `venue_orders`, `venue_pools`, `markets`,
  `market_metadata` (all already indexed).
