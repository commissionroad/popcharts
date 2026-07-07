---
type: summary
title: "ADR 0003: Keep V1 Receipts Locked And Non-Transferable"
description: Accepted — v1 receipts are locked, append-only, non-withdrawable, and non-transferable until graduation, cancellation, expiry, or refund; secondary receipt markets are deferred
sources:
  - protocol/docs/adr/0003-keep-v1-receipts-locked-and-non-transferable.md
updated: 2026-07-07
---

# ADR 0003: Keep V1 Receipts Locked And Non-Transferable

**Status: Accepted.**

## Decision

V1 receipts are locked, append-only, non-withdrawable, and non-transferable
until graduation, cancellation, expiry, or refund.

## Context

Receipts are the durable record of committed pre-graduation demand. If
holders could freely withdraw or transfer receipts before clearing, the
bootstrap curve would become a cheap manipulation surface and clearing
ownership would be harder to reason about.

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
