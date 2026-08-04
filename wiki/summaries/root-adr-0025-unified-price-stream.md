---
type: summary
title: ADR 0025 — One Price Stream Across Graduation (docs/adr/0025-unified-price-stream.md)
description: PROPOSED program collapsing the two price paths into one — a per-pool sequence emitted by the bounded hook (near-free before deploy, a venue migration after), server-side derivation for both halves, one read endpoint and one point shape, and a chart blind to the phase. Six phases, none started.
sources:
  - docs/adr/0025-unified-price-stream.md
updated: 2026-08-04
---

# ADR 0025 — One Price Stream Across Graduation

PROPOSED. Follows on from [ADR 0021](root-adr-0021-live-market-updates.md),
whose live spine shipped for pre-graduation trades only; the post-graduation
half was wired later (PRs #401/#408/#427) against different assumptions. See
[price stream](../concepts/price-stream.md) for the mechanism itself.

## The symptom

A pre-graduation trade appends one chart point. A post-graduation swap reloads
the whole page. One line in each indexer handler explains it: `receipt-placed`
passes `tick: buildPriceTick(...)` to `recordLiveChange`; `pool-price-ticks`
passes no `tick` at all. With no price on the frame the client cannot append,
so it refetches the market, every receipt, and the whole venue history to learn
one number — exactly the O(history)-for-O(1) cost ADR 0021's tick payload was
introduced to avoid, now falling on the half of the lifecycle that trades most.

## Forced vs accidental divergence

**Forced.** `ReceiptPlaced` carries market, side, size and a per-market
sequence; `AfterSwapTickObserved` carries a pool id and a raw tick. The
post-graduation path must translate tick→price and pool→market, and always
will.

**Accidental** — everything downstream: the LMSR replay exists twice (app
`pricePathFromReceipts` and server `buildPriceTick`, held together by a parity
test), two downsample caps (256 app / 240 server), two response shapes, two
chart inputs.

**Already unified, unused:** `PriceTickWire` is already
`{t, sequence, yesPriceCents, noPriceCents}`; every change frame already carries
`blockNumber`/`logIndex`; the chart reads the phase in exactly one place (the
complete-set row); `getMarketReceipts` has one non-test consumer.

## The ordering analysis

Incremental append needs a way to tell a fresh point from a missed one.
Pre-graduation's `sequence === last + 1` works because the ordinal comes from
*outside* the delivery pipeline — the contract assigns it, so it acts as a
checksum on delivery. This is load-bearing: `change-feed/relay.ts` documents
that a lower `change_feed.id` can commit after a higher one is read, and the
sequence check converts that race into a detected gap and a refetch.

Three candidates were weighed:

- **Indexer-assigned counter — rejected.** Stamped in row-lock order, not chain
  order, so a catch-up sweep racing live delivery could produce a sequence that
  is contiguous *and* wrong. A checksum computed by the system it checks always
  passes.
- **`(blockNumber, logIndex)`** — chain-true, totally ordered, already on the
  wire, but not contiguous, so it cannot detect gaps.
- **A counter in the hook — chosen.** Two of three objections do not hold:
  nothing is deployed, so the pool-id migration cost (the hook address is part
  of the `PoolKey`) is currently zero and becomes permanent at first deploy;
  and `SwapTickObservation` is 7 bytes of a 32-byte slot already written on
  every swap, so a `uint64` packs in near-free. The third is real — the hook is
  keyed by `PoolId` and knows nothing of markets, so the counter is **per-pool**
  and a market has two.

## Decisions

1. Bounded hook emits a per-pool `uint64` sequence.
2. Client keys sequences **by stream** (receipt book, or each outcome pool) —
   one entry pre-graduation, two after, one rule, no phase branch.
3. Server owns all price derivation; the app's LMSR replay and its parity test
   are deleted.
4. One read endpoint for a market's whole life, one point shape, one cap.
5. The chart takes one array; `graduatedAt` is a pure annotation.

Explicitly reverses the `pool_price_ticks` schema note that *"only the raw tick
is stored; price derivation lives in the API/app layer"* — the raw tick stays,
the derived price is additional, and the API keeps deriving for historical reads
so old rows need no backfill.

## Phases

Six, none started. P1 hook sequence (**with a gas measurement gate** — if the
delta is materially above the assumed near-zero, stop and revisit), P2 indexer
emits a priced tick, P3 unified endpoint, P4 app collapses to one path, P5
client stream sequences, P6 end-to-end proof on a local stack.

## Deferred / open

- The assembled server path (pools + ticks + decimals read) has **never run in
  CI** — only by hand, locally. P6 is its first automated coverage.
- If P1's gas measurement kills the hook counter, the fallback is
  `(blockNumber, logIndex)` ordering with no gap detection — misses heal on the
  next page load. Acceptable, but a different decision to be recorded as one.
- `/receipts` stays for other consumers; the chart just stops using it.
- Discovery-board prices still refetch rather than append; out of scope, same
  payload would serve them.
