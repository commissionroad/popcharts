# ADR 0003: Keep V1 Receipts Locked And Non-Transferable

## Status

Accepted

## Context

Receipts are the durable record of committed pre-graduation demand. If holders
can freely withdraw or transfer receipts before clearing, the bootstrap curve
can become a cheap manipulation surface and clearing ownership becomes harder
to reason about.

## Decision

V1 receipts are locked, append-only, non-withdrawable, and non-transferable
until graduation, cancellation, expiry, or refund.

## Consequences

The product must label receipts honestly as provisional locked intents.
Secondary receipt markets and pre-clearing exits are deferred until they can be
designed without weakening deterministic clearing or price credibility.
