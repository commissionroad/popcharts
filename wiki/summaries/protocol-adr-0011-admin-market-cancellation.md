---
type: summary
title: Protocol ADR 0011 — Admin market cancellation for content moderation
description: Proposed (code landed ahead of the status line) — an owner-only cancelMarket kill switch that halts an Active market for moderation and opens full escrow refunds through the existing claim path, under a distinct Cancelled status.
sources:
  - protocol/docs/adr/0011-admin-market-cancellation.md
updated: 2026-07-14
---

# Protocol ADR 0011: Admin Market Cancellation for Content Moderation

**Status: Proposed** — Track C (a fund-holding contract change, so human review
is required and it is never merged by an unattended session, per repo ADR 0016).
Dated 2026-07-11.

> **Doc/code drift, flagged not fixed:** the ADR still reads *Proposed*, but the
> mechanism has landed on `main` — `PregradManager.cancelMarket` /
> `MarketCancelled` (PR #186), the widened refund-claim guard, and the server's
> `market_cancelled_events` table with its settlement watcher are all present.
> The wiki never edits raw sources; the status line is the doc's to update.

## Context

A market can reach `Active` and accumulate real bettor escrow before anyone
discovers the content is policy-violating — AI review is a gate, not a guarantee.
Before this ADR there was **no moderator kill switch for a live market holding
money**:

- `rejectMarket` only applies during `UnderReview`. Receipts can only be placed
  on `Active` markets, so a rejected market holds no escrow — that path never
  refunds anyone.
- `markRefundable` opens full refunds but is gated to at/after
  `graduationDeadline`, which can be days away.

Meanwhile `MarketStatus.Cancelled` existed in the enum but was **never assigned
by any function**, and the server portfolio already rendered a `cancelled` market
as `refund_claimable` — a projection with no on-chain path behind it. The UI was
offering a claim that would have reverted.

## Decision

Add an owner-only `cancelMarket(uint256 marketId)` to `PregradManager` that halts
an `Active` market and opens full escrow refunds, **reusing the existing
refund-claim machinery so it inherits its safety** rather than introducing a
second refund accounting path.

- **Distinct status.** Sets `MarketStatus.Cancelled`, deliberately *not*
  `Refunded` (missed deadline), so the audit trail and the UI can distinguish
  "removed by a moderator" from "did not graduate".
- **Refund path reused, not duplicated.** The claim guard widens from "`Refunded`
  only" to "`Refunded` or `Cancelled`"; every bettor calls the same
  `claimRefundedReceipt(receiptId)`, which returns the receipt's full escrowed
  `cost`, marks the receipt inactive, and decrements `totalEscrowed`.
- **Scope: `Active` markets only.** `UnderReview` holds no escrow (use
  `rejectMarket`); everything mid- or post-graduation is a postgrad concern with
  its own resolution/cancellation surface on `CompleteSetBinaryMarket`.
- **Access: `onlyOwner`.** Operators invoke it locally with the operator key,
  never through the deployed API — consistent with the
  [operator-access model](../concepts/market-lifecycle.md) established across
  repo ADRs 0009/0011/0012/0015.
- **Event:** `MarketCancelled(marketId, totalEscrowed)`, mirroring
  `MarketRefundsAvailable`, so the indexer flips the projected status and the
  portfolio's existing `refund_claimable` path becomes real end to end.
- **Creation fee is not refunded.** Cancellation returns *bettor* escrow only;
  the creator's fee stays with the
  [fee vault](../entities/creation-fee-vault.md). An inappropriate creator does
  not get their fee back.

## Why double-refund safety is inherited, not re-argued

The ADR's central claim is that reusing `claimRefundedReceipt` means no new
safety argument is needed. Three existing properties compose:

1. A receipt is claimable exactly once — `receipt.active` flips false and
   inactive receipts are rejected.
2. Status transitions are one-way and mutually exclusive — `cancelMarket`
   requires `Active`, so a graduating, graduated, or already-cancelled market
   reverts.
3. Every claim draws down a fixed escrow pool it can never exceed.

`Cancelled` and `Refunded` share the claim path, but a market only ever holds one
status, so the two can never overlap on the same receipt.

## Consequences

- Refunds stay **pull-based**: `cancelMarket` *opens* claims, it does not push
  funds. Whether an operator auto-claims on bettors' behalf (as the graduation
  path does) is tracked with the broader claims-UX decision, not here.
- It makes the portfolio's pre-existing `cancelled → refund_claimable` mapping
  correct instead of dangling.
- Ships with full Solidity coverage (cancel gating, refund-after-cancel,
  double-refund prevention, terminal-status rejection).

## Related pages

- [../entities/pregrad-manager.md](../entities/pregrad-manager.md)
- [../entities/creation-fee-vault.md](../entities/creation-fee-vault.md)
- [../entities/indexer.md](../entities/indexer.md)
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md)
- [../concepts/graduation-clearing.md](../concepts/graduation-clearing.md)
- [../summaries/portfolio-data-design.md](portfolio-data-design.md)
- [../summaries/root-adr-0011-ai-review-service-hardening.md](root-adr-0011-ai-review-service-hardening.md)
