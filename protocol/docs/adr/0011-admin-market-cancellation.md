# ADR 0011: Admin Market Cancellation for Content Moderation

Status: Proposed — Track C (fund-holding contract change; human review required, do not merge autonomously per repo ADR 0016)

Date: 2026-07-11

## Context

A market can reach `Active` and accumulate bettor escrow before we discover it
is inappropriate (policy-violating content that slipped past AI review). Today
there is no way to halt such a market and return funds promptly:

- `rejectMarket` (review-manager) only applies during `UnderReview`, before the
  market is `Active`. Receipts can only be placed on `Active` markets, so a
  rejected market holds no escrow — this path never refunds anyone.
- `markRefundable` opens full refunds but is gated to _at/after_
  `graduationDeadline`. An inappropriate `Active` market therefore cannot be
  stopped until its deadline arrives, which can be days away.

So a live market with real money in it has no moderator kill switch. The
`MarketStatus.Cancelled` enum value exists but is never assigned by any
function, and the server portfolio already renders a `cancelled` market as
`refund_claimable` — a projection with no on-chain path behind it.

## Decision

Add an owner-only `cancelMarket(uint256 marketId)` to `PregradManager` that
halts an `Active` market for moderation reasons and opens full escrow refunds,
reusing the existing refund-claim machinery so it inherits its safety.

- **Status:** sets `MarketStatus.Cancelled` — deliberately distinct from
  `Refunded` (missed deadline) so the audit trail and UI can tell "removed by a
  moderator" from "did not graduate."
- **Refund path (reused, not duplicated):** widen the refund-claim guard from
  "`Refunded` only" to "`Refunded` or `Cancelled`" so each bettor calls the same
  `claimRefundedReceipt(receiptId)`, which returns the receipt's full escrowed
  `cost`, marks the receipt inactive, and decrements `totalEscrowed`. No new
  refund accounting is introduced.
- **Scope:** `Active` markets only. `UnderReview` holds no escrow (use
  `rejectMarket`). `Graduating`/`Graduated`/`Resolved`/`Refunded`/`Cancelled`/
  `Rejected` are rejected — a market mid- or post-graduation is a postgrad
  concern with its own resolution/cancellation surface
  (`CompleteSetBinaryMarket`), out of scope here.
- **Access:** `onlyOwner`. Operators invoke it locally with the operator key,
  never through the deployed API (consistent with the operator model in repo
  ADR 0009 / the graduation-trigger decision). No public or API-reachable
  cancel.
- **Event:** emit `MarketCancelled(marketId, totalEscrowed)` (mirroring
  `MarketRefundsAvailable`) so the indexer flips the projected status to
  `cancelled` and the portfolio's existing `refund_claimable` path becomes real
  end to end.
- **Creation fee:** cancellation returns _bettor_ escrow only. The creator's
  market-creation fee (held by the fee vault, repo ADR 0016 C1) is not refunded
  — an inappropriate creator does not get their fee back; it remains withdrawable
  by the protocol.

## Consequences

- **Double-refund safety is inherited, not re-argued.** A receipt is claimable
  exactly once (`receipt.active` flips false and inactive receipts are
  rejected); status transitions are one-way and mutually exclusive
  (`cancelMarket` requires `Active`, so a graduating/graduated/already-cancelled
  market reverts); and every claim draws down a fixed escrow pool it can never
  exceed. `Cancelled` and `Refunded` share the claim path but a market only ever
  holds one status, so the two never overlap on the same receipt.
- Refunds remain **pull-based** — `cancelMarket` opens claims; it does not push
  funds. Whether an operator/keeper auto-claims on bettors' behalf (as the
  graduation path does) or leaves claims to users is a product choice tracked
  with the broader claims-UX decision, not this ADR.
- This makes the portfolio's pre-existing `cancelled → refund_claimable`
  mapping correct instead of dangling; without the widened claim guard, that UI
  would offer a claim that reverts.
- Track C: this touches a contract that custodies funds. It ships as a reviewed
  PR with full Solidity coverage (cancel gating, refund-after-cancel,
  double-refund prevention, terminal-status rejection); it is not merged by an
  unattended session.
