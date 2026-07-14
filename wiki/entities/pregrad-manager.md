---
type: entity
title: PregradManager
description: Singleton contract owning all pre-graduation market state — creation, review gate, receipt escrow, virtual LMSR quoting, and optimistic graduation clearing.
sources:
  - protocol/docs/adr/0005-use-a-singleton-pregrad-manager.md
  - protocol/docs/adr/0006-use-optimistic-offchain-graduation-clearing.md
  - protocol/docs/adr/0009-complete-set-testnet-policy.md
  - protocol/docs/adr/0011-admin-market-cancellation.md
  - protocol/README.md
  - docs/adr/0016-monorepo-architecture-cleanup-program.md
  - documents/whitepaper_v4.pdf
updated: 2026-07-14
---

# PregradManager

`protocol/contracts/PregradManager.sol` — the singleton entry point of the
protocol. One contract owns every pre-graduation market, keyed by `marketId`;
receipts are internal ledger records keyed by `receiptId`, not tokens or
per-market contracts. The originally scaffolded factory-per-market design was
declared transitional in [protocol ADR 0005](../summaries/protocol-adr-0005-singleton-pregrad-manager.md)
and is fully replaced.

## Responsibilities

- Market creation behind the `UnderReview` gate; `MarketCreated` emits both the
  `metadataHash` and the canonical metadata JSON payload so the indexer can
  verify metadata without an off-chain POST ([root ADR 0006](../summaries/root-adr-0006-server-runtime-and-indexer.md)).
- Virtual LMSR quoting and receipt placement: each buy records a path interval
  `[r_low, r_high]` with exact path-integral cost — see
  [mechanism whitepaper](../concepts/mechanism-whitepaper.md) §3–4. Market
  config (collateral, creator, metadata hash, opening probability, `b`,
  graduation threshold/deadlines) is immutable after creation.
- Collateral escrow with the accounting identity `escrow = retained cost + refund`;
  receipts are locked, non-withdrawable, non-transferable in v1
  ([protocol ADR 0003](../summaries/protocol-adr-0003-v1-receipts-locked-non-transferable.md)).
- Optimistic clearing: `startGraduation` locks the book → offchain service
  computes band-pass clearing → `submitClearingRoot` (Merkle root + totals) →
  challenge window (owner-configurable, default 0 per
  [protocol ADR 0010](../summaries/protocol-adr-0010-disable-the-clearing-challenge-window-by-default.md))
  → `finalizeGraduation` funds the
  [postgrad adapter](postgrad-adapter.md) → per-receipt Merkle claims. See
  [graduation clearing](../concepts/graduation-clearing.md).
- Refunds: deadline passing while `Active` makes the market refundable; refunded
  markets settle entirely from PregradManager without touching the adapter.
- **Moderation kill switch:** owner-only `cancelMarket(marketId)` halts an
  `Active` market whose content turns out to be policy-violating, sets
  `MarketStatus.Cancelled`, and emits `MarketCancelled(marketId, totalEscrowed)`
  — opening full escrow refunds through the *same* `claimRefundedReceipt` path
  (its guard widened from "`Refunded` only" to "`Refunded` or `Cancelled`"), so
  no second refund accounting exists. `Active` only; the creation fee is **not**
  returned. See
  [protocol ADR 0011](../summaries/protocol-adr-0011-admin-market-cancellation.md).

## Key decisions and invariants

- Security invariants: no final fixed-payout exposure before graduation; no
  clearing path may exceed locked collateral; no postgrad venue may rescue an
  undercollateralized market ([protocol CODE_GUIDELINES](../summaries/protocol-code-guidelines.md)).
- Claim leaves verify `retainedCost + refund == receipt.cost`.
- Creation fee: `MARKET_CREATION_FEE = 1e18` native units, waived for trusted
  creators; custody now lives in the abstract [CreationFeeVault](creation-fee-vault.md)
  base (cleanup program C1, landed 2026-07-07), policy stays here.
- `isReviewManager` / `isGraduationManager` both resolve to the owner in v1
  ([protocol ADR 0009](../summaries/protocol-adr-0009-complete-set-testnet-policy.md)).
- Was the repo's largest contract (1,365 lines), now ~1,090 after the
  [cleanup program](../summaries/root-adr-0016-monorepo-architecture-cleanup-program.md)
  closed: fee custody moved to the `CreationFeeVault` base (C1) and receipt
  mechanics to an abstract **`ReceiptBook`** base (C2, PR #132 — ID allocation,
  receipt storage/lookups, liveness guards, sequence math, receipt errors). The
  LMSR quote entry points deliberately **stayed here**: they read live market
  state, and moving them would hand the book access to market records. Both
  extractions are ABI-identical (zero-diff metadata regeneration).
- `bypassAiResolution` travels through creation but has no finalized semantics
  ([root ADR 0008](../summaries/root-adr-0008-protocol-functionality-completion.md)).

## Related pages

- [Market lifecycle](../concepts/market-lifecycle.md) — the status ladder it enforces
- [Graduation clearing](../concepts/graduation-clearing.md) — the mechanism it commits to
- [Indexer](indexer.md) — consumes its eleven event types as the whole input surface
- [Postgrad adapter](postgrad-adapter.md) — the finalization boundary
