---
type: summary
title: "ADR 0003: Keep V1 Receipts Locked And Non-Transferable"
description: Accepted, partially superseded 2026-08-04 by ADR 0014 — receipts stay non-transferable, but unopposed bands became withdrawable before the freeze; secondary receipt markets are still deferred
sources:
  - protocol/docs/adr/0003-keep-v1-receipts-locked-and-non-transferable.md
updated: 2026-08-04
---

# ADR 0003: Keep V1 Receipts Locked And Non-Transferable

**Status: Accepted. Partially superseded 2026-08-04 by
[ADR 0014](protocol-adr-0014-pre-graduation-withdrawals-and-fees.md).**

## Decision

V1 receipts are **non-transferable** until graduation, cancellation, expiry, or
refund. The blanket no-withdrawal half is retired: under ADR 0014, bands no
opposite-side receipt has ever covered may be withdrawn before the freeze.

## Context

Receipts are the durable record of committed pre-graduation demand. If
holders could freely withdraw or transfer receipts before clearing, the
bootstrap curve would become a cheap manipulation surface and clearing
ownership would be harder to reason about.

The manipulation concern was right in substance and wrong in scope. Free
withdrawal at recorded cost creates no bad debt — escrow is per-receipt, so
returning it leaves `E = R + L` intact — but it lets a large holder destroy
matched cap `F` and deny graduation unilaterally. ADR 0014 commits capital
exactly where it has met a counterparty, removing the veto by construction.

## Consequences

- The product must label receipts honestly as provisional locked intents —
  a constraint on the receipt-centric UI the
  [Constitution](protocol-constitution.md) requires.
- Secondary receipt markets and pre-clearing exits are deferred until they
  can be designed without weakening deterministic clearing
  ([graduation clearing](../concepts/graduation-clearing.md)) or price
  credibility.
- The [pregrad manager](../entities/pregrad-manager.md) implements receipts
  as internal ledger records rather than transferable tokens, consistent with
  [ADR 0005](protocol-adr-0005-singleton-pregrad-manager.md).

## Related pages

- [Market lifecycle](../concepts/market-lifecycle.md)
- [Summary: protocol context glossary](protocol-context.md) — the receipt
  definition this ADR locks down
