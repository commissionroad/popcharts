---
type: concept
title: Price stream — how a market price reaches the chart
description: The path from an on-chain trade to a point on the market chart, in both lifecycle halves — what is shared, what diverged, and the ordering guarantee that decides whether the client can append or must refetch.
sources:
  - docs/adr/0021-live-market-updates.md
  - docs/adr/0025-unified-price-stream.md
  - protocol/docs/adr/0009-complete-set-testnet-policy.md
updated: 2026-08-04
---

# Price stream

One chart line, two data paths. This page is the mechanism; the programs that
built and are unbuilding the split are
[ADR 0021](../summaries/root-adr-0021-live-market-updates.md) and
[ADR 0025](../summaries/root-adr-0025-unified-price-stream.md).

## What a chart point is

Three values: a timestamp, a YES price in cents, a NO price in cents. Both
halves of the lifecycle agree on this — it is the routes that differ, not the
destination.

Before graduation the pair is complementary by construction: one virtual LMSR
state yields YES, and NO is `100 − YES`. After graduation the two outcomes
trade in **separate pools**, so the prices are independent observations that
only approach a complete set as arbitrage closes the gap. Fees and arbitrage
make a sum other than 100 normal post-graduation, not a defect.

## The two routes

| Stage | Before graduation | After graduation |
| --- | --- | --- |
| Chain event | `ReceiptPlaced` — market, side, size, per-market sequence | `AfterSwapTickObserved` — pool id, raw tick |
| Indexer | replays LMSR, attaches price to the change frame | stores the raw tick, attaches nothing |
| Live frame | carries a `PriceTickWire` | pure nudge |
| Client | appends one point | `router.refresh()` — full page refetch |
| Page load | `/receipts`, browser replays LMSR, cap 256 | `/venue-price-history`, server derives, cap 240 |

The event asymmetry is forced — the two contracts were written for different
jobs, and `PregradManager` gets its sequence free because `receiptCount` is
already part of the `GraduationSnapshot` struct and the settlement path.
Everything below the event is accidental divergence that ADR 0025 removes.

## The handoff

The venue pools are initialised at the pre-graduation book's closing price
(`closingYesDisplayPriceWad`), so the line is continuous across graduation by
construction rather than by interpolation. The API synthesises an opening point
at the graduation timestamp from that same function, which is why a market that
has graduated but not yet traded still charts a complete line up to the
handoff.

## Ordering: why one half can append and the other cannot

Appending a point incrementally is only safe if the client can distinguish a
fresh point from a missed one. The pre-graduation check is
`sequence === last + 1`, and it is trustworthy because the ordinal is
**contract-assigned** — produced outside the delivery pipeline, so it works as
a checksum on that pipeline rather than a product of it.

That matters concretely: the change-feed relay documents that a lower
`change_feed.id` can commit after a higher one has been read. When that race
reorders delivery, the sequence check sees a gap and forces a refetch, and the
chart stays correct.

The lesson generalises: an ordinal minted by the indexer would be stamped in
write order rather than chain order, so it could be perfectly contiguous while
encoding the wrong sequence — and the check would pass. **A checksum computed
by the system it checks always passes.** Only a chain-assigned ordinal —
`(blockNumber, logIndex)` for ordering, or a contract counter for gap
detection — carries real information about delivery.

## Related

- [ADR 0021 — live market updates](../summaries/root-adr-0021-live-market-updates.md)
- [ADR 0025 — one price stream](../summaries/root-adr-0025-unified-price-stream.md)
- [Complete sets](complete-sets.md)
- [Market lifecycle](market-lifecycle.md)
- [Indexer](../entities/indexer.md)
