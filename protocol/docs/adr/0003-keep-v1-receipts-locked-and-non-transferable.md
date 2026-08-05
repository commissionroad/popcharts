# ADR 0003: Keep V1 Receipts Locked And Non-Transferable

## Status

Accepted. **Partially superseded 2026-08-04 by
[ADR 0014](0014-pre-graduation-withdrawals-and-fees.md).** Receipts remain
non-transferable. They are no longer unconditionally non-withdrawable: bands no
opposite-side receipt has ever covered may be withdrawn before the freeze.

## Context

Receipts are the durable record of committed pre-graduation demand. If holders
can freely withdraw or transfer receipts before clearing, the bootstrap curve
can become a cheap manipulation surface and clearing ownership becomes harder
to reason about.

The manipulation concern was correct in substance and wrong in scope. Free
withdrawal at recorded cost does not create bad debt — escrow is per-receipt,
so returning it leaves `E = R + L` intact — but it does let a large holder
destroy matched cap `F` and unilaterally deny graduation. ADR 0014 keeps
capital committed exactly where it has met a counterparty, which removes the
veto by construction rather than by policy.

## Decision

V1 receipts are non-transferable until graduation, cancellation, expiry, or
refund.

Withdrawal is governed by ADR 0014: opposed bands are locked, unopposed bands
are withdrawable. The blanket no-withdrawal rule this ADR originally stated is
retired.

## Consequences

- The product must label receipts honestly as provisional intents, and must
  distinguish the committed part of a position from the withdrawable part
  without implying that withdrawal is free exit — in practice most of an active
  book is opposed.
- Secondary receipt markets remain deferred. ADR 0014 notes that Lemma 3's
  argument extends to transfers by inspection, but refund ownership across a
  fragmented, partially withdrawn receipt is unresolved and is the real blocker.
- The pregrad manager implements receipts as internal ledger records rather
  than transferable tokens, consistent with
  [ADR 0005](0005-use-a-singleton-pregrad-manager.md).
