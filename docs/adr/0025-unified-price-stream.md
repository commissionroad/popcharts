# ADR 0025: One Price Stream Across Graduation

Status: Proposed

Date: 2026-08-04

## Context

A market's price chart is one line, but the data behind it travels two
unrelated routes depending on whether the market has graduated. ADR 0021 built
the live-update spine and shipped the pre-graduation half of it; the
post-graduation half was wired much later (PRs #401/#408/#427) against a
different set of assumptions. The result works, but it is two systems doing one
job, and the seam is now the most expensive part of the market page.

### The symptom

A pre-graduation trade appends one point to the chart. A post-graduation swap
reloads the entire page. The cause is one line in each handler:

- `server/src/indexer/handlers/receipt-placed.ts` calls `recordLiveChange`
  with `tick: buildPriceTick({ ... })`.
- `server/src/indexer/handlers/pool-price-ticks.ts` calls it with no `tick`.

With no price on the frame, `MarketLivePrice` cannot append a point, so it
falls to `router.refresh()` — refetching the market, every receipt, and the
whole venue history to learn one number. ADR 0021 introduced the tick payload
precisely to avoid that: *"O(history) work for O(1) new information."* The half
of the lifecycle that trades most actively is the half without the
optimisation.

### Why the two routes diverged — the part that is forced

The contract events differ in richness, and that difference is real:

| Event | Carries |
| --- | --- |
| `ReceiptPlaced` (`PregradManager`) | market, side, size, and a per-market sequence |
| `AfterSwapTickObserved` (`BoundedPredictionHook`) | a pool id and a raw tick |

`PregradManager.sol` assigns its own counter (`sequence = _nextReceiptSequence(market.state.receiptCount)`),
and it does so because the contract needs `receiptCount` anyway — it is a field
of the `GraduationSnapshot` EIP-712 struct and part of the settlement path. The
chart gets that ordinal as a free byproduct of state the protocol already keeps.

The swap event has no equivalent. The post-graduation path must therefore
*translate*: raw tick to price, pool to market. That work has no pre-graduation
counterpart and is not going away.

### Why they diverged — the part that is accidental

Everything downstream of that translation drifted apart for no reason anyone
chose:

- **Price maths runs in two places.** The app replays the LMSR from raw
  receipts (`pricePathFromReceipts`); the server computes it for the live tick
  (`buildPriceTick`) and for the whole venue history. Two implementations of
  one formula, kept in agreement by a parity test whose only job is to notice
  when they disagree. The test is the duplication announcing itself.
- **Two downsample caps.** `MAX_PRICE_PATH_POINTS = 256` in the app;
  `MAX_VENUE_PRICE_POINTS = 240` on the server. Nobody decided that.
- **Two response shapes.** `/receipts` returns raw events for the client to
  replay; `/venue-price-history` returns finished prices.
- **Two chart inputs.** `PriceCurve` takes `points` plus `postgradPoints` and
  normalises them internally.

### What is already unified

The unification is mostly a deletion, because the pieces already exist:

- **`PriceTickWire` is already the unified point**: `{ t, sequence,
  yesPriceCents, noPriceCents }`. Both prices, timestamped, phase-agnostic. One
  side simply never populates it.
- **Every change frame already carries `blockNumber` and `logIndex`** —
  chain-assigned ordering coordinates, free, already on the wire.
- **The chart consults the phase in exactly one place** — the complete-set
  ("Set") row in the crosshair. Everything else about `CurvePhase` is carried
  and never read.
- **`getMarketReceipts` has exactly one non-test consumer**: this chart.
  Unifying removes a fetch and a client-side replay from the market page
  outright.

### The ordering question

Incremental append is only safe if the client can tell a fresh point from a
missed one. Pre-graduation it checks `sequence === last + 1`.

That check is trustworthy **because the number comes from outside our
pipeline**. It is assigned by the contract, in chain order, before the indexer
sees it, so it functions as a checksum *on* delivery rather than a product of
it. The value of that is concrete: `server/src/change-feed/relay.ts` documents
that a lower `change_feed.id` can commit after a higher one has been read. When
that race reorders delivery, the sequence check sees a gap, refetches, and the
chart stays correct.

Three candidate ordinals for the post-graduation side were considered.

**An indexer-assigned counter** (`UPDATE markets SET price_seq = price_seq + 1
... RETURNING`) is mechanically easy and was rejected. It would be stamped in
*our* write order — whichever transaction won the row lock — not chain order. A
catch-up sweep racing live delivery could stamp an earlier block with a higher
number, producing a sequence that is perfectly contiguous *and* wrong. The
client's check would pass while the chart drew points out of order. A checksum
computed by the system it is checking always passes.

**`(blockNumber, logIndex)`** is chain-assigned, totally ordered, free, and
already on every frame. It detects reordering and duplicates but cannot detect
a gap, because it is not contiguous.

**A counter in the hook** was initially rejected on cost and then re-examined,
because two of the three objections do not hold:

- *Migration.* The hook address is part of the `PoolKey` and therefore of every
  pool id (`protocol/src/market/outcomePoolKey.ts`), so changing the hook after
  deployment renames every pool and orphans its liquidity. **Nothing is
  deployed yet**, so this cost is currently zero and becomes permanent on the
  first deploy.
- *Gas.* `SwapTickObservation` is `{ bool observed; int24 beforeTick; int24
  afterTick }` — 7 bytes of a 32-byte slot — and the hook already writes it on
  every swap, in both `beforeSwap` and `afterSwap`. A `uint64` packs into the
  spare 25 bytes of a slot that is already warm and already being stored to.
  The marginal cost is an increment, not a new storage write.
- *Scope.* The hook has no concept of markets; it is keyed by `PoolId` and
  stores nothing else. The counter is therefore **per-pool**, and a market has
  two pools. This one is real, and shapes the decision below.

## Decision

Collapse the two routes into one price stream, and take the chain-assigned
ordinal while it is still free.

1. **Emit a per-pool sequence from the bounded hook.** Add a `uint64` to
   `SwapTickObservation`, increment it in `afterSwap`, and include it in
   `AfterSwapTickObserved`. This yields the same *kind* of ordinal
   `PregradManager` provides: assigned by consensus, in chain order,
   independent of our pipeline.

2. **Key client sequences by stream, not by market.** A stream is the receipt
   book before graduation and each outcome pool after it. The client holds
   `Map<stream, lastSequence>` — one entry pre-graduation, two post — and
   applies the identical `=== last + 1` rule to every stream. No branch on
   phase; a missed tick on either pool is a missed point and is caught.

3. **The server owns all price derivation.** Delete `pricePathFromReceipts`
   and its parity test from the app. The LMSR replay exists once, server-side,
   where it already exists for the live path.

4. **One read endpoint for a market's whole life**, returning one shape:
   `{ points: [{ at, yesCents, noCents }], graduatedAt? }`. One downsample cap.

5. **The chart takes one array.** `PriceCurve` receives a single list of points
   and cannot tell which half of the lifecycle produced them. `graduatedAt`
   remains a pure annotation — it moves a rule and a shaded region, and touches
   nothing about how the line is computed.

### What this deliberately reverses

`server/src/db/schema/pool-price-ticks.ts` states that *"only the raw tick is
stored; price derivation lives in the API/app layer."* Emitting a priced tick
requires deriving at index time. That is an intentional reversal, recorded here
rather than left as drift. The raw tick stays on the row; the derived price is
additional, and the API keeps deriving for historical reads so a replay of
older rows needs no backfill.

## Consequences

- A post-graduation swap costs one appended point instead of a full page
  refetch, per viewer. This matters most exactly where it currently hurts most:
  an actively trading graduated market.
- The market page makes one data fetch for the chart instead of two, and stops
  replaying trade history in the browser.
- One formula, one cap, one shape, one code path; the parity test is deleted
  because the thing it guarded against no longer exists.
- The indexer gains a collateral-decimals read (memoised per collateral — ERC20
  decimals are immutable) in order to convert ticks to cents.
- The protocol gains a small amount of state and one more thing to audit under
  ADR 0023.
- Pre-graduation behaviour is unchanged: it keeps the contract-assigned
  sequence and the same gap check it has today.

## Phases

- [x] **P1 — Hook sequence.** Add the packed `uint64` to
  `SwapTickObservation`, increment in `afterSwap`, extend
  `AfterSwapTickObserved`, regenerate ABIs. Measure the gas delta and record it
  here; if it is materially above the near-zero this ADR assumes, stop and
  revisit. **Measured: steady-state swap through the hook went 64,574 →
  65,127 gas (+553, ~0.9%)** on the third swap of a warm pool
  (`BoundedHookSwapGas.t.sol`, identical harness both sides of the change).
  The delta is the increment plus 8 bytes of event data — no new storage
  write, as the packed-slot analysis predicted. Gate passes.
- [x] **P2 — Indexer emits a priced tick.** Persist the sequence, resolve the
  sibling pool's last price (indexed lookup on
  `pool_price_ticks_chain_pool_time_idx`), convert both to cents with a
  memoised decimals read, and populate the change-feed `tick` payload with its
  stream id.
- [x] **P3 — Unified read endpoint.** One price-history endpoint spanning both
  phases, server-side LMSR replay for the pre-graduation half, one downsample
  cap, synthesised handoff point retained.
- [x] **P4 — App collapses to one path.** Single fetch, single chart input,
  delete `pricePathFromReceipts` and the parity test, drop `CurvePhase` from
  the chart's inputs.
- [x] **P5 — Client stream sequences.** `Map<stream, lastSequence>`, one append
  rule for both phases, remove the post-graduation refetch guard added in #427.
  Review hardened the append with two extra guards: frames carry their chain
  coordinates and one that lands behind the newest appended coordinate
  refetches instead of plotting backwards, and the whole gap/append decision
  runs inside the React updater so same-batch frames cannot race a stale
  closure.
- [x] **P6 — End-to-end proof on a local stack.** Graduate a market, drive
  swaps, and assert the chart appends without a page refetch across the
  handoff. This also closes the gap noted below. **Run 2026-08-04** on a
  slot-2 stack: 60 bot receipts, dev-force graduation, then bot venue swaps
  on the market's own pools. Observed: pregrad ticks appended live with zero
  RSC refetches; graduation flipped the page via the nudge path; venue ticks
  from both pool streams (interleaved ordinals) appended live with zero RSC
  refetches once seeded; ticks that arrived while the tab was hidden
  correctly triggered gap-refetches instead of silent holes. The unified
  read served the whole life continuously across the handoff
  (49.027 -> 49.027 -> 49.14) with the per-pool `streams` seed map, and a
  band-edge NO print (tick 0 -> 100c) rendered faithfully.

## Deferred / open

- **The assembled server path in CI: covered.** The lifecycle lane's golden
  journey now asserts it end to end — after the in-browser venue trade, the
  unified read must show a venue point past `graduatedAt`, a hook-stamped
  `streams` ordinal, and price continuity at the handoff. (Originally
  deferred here as "has never run in CI"; closed by the follow-up that added
  the assertions.)
- **Gap detection depends on the gas measurement in P1.** If the hook counter
  turns out to cost more than assumed and is dropped, the fallback is
  `(blockNumber, logIndex)` ordering with no gap detection — misses would then
  heal on the next page load rather than triggering a refetch. That is an
  acceptable degradation, but it is a different decision and should be recorded
  as one.
- **`/receipts` stays.** The chart stops using it; the endpoint remains for any
  other consumer.
- **Discovery-board prices** still refetch on signal rather than appending.
  Out of scope here; the same tick payload would serve them.
