# ADR 0002: Treat Whitepaper V4 As The Mechanism Source

## Status

Accepted

## Context

The repository contains multiple whitepaper versions. Earlier versions include
useful lifecycle and architecture ideas, but they also include older clearing
approaches that v4 supersedes.

## Decision

Use `../documents/whitepaper_v4.pdf` as the source of truth for protocol
semantics. Earlier papers are context only.

## Consequences

The implementation should follow virtual LMSR receipts over exact path
intervals and deterministic band-pass clearing. Aggregate share matching,
aggregate collateral matching, and receipt-average partial fills are explicitly
out of scope unless a future whitepaper revision and ADR change the mechanism.
