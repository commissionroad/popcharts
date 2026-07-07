---
type: summary
title: "ADR 0002: Treat Whitepaper V4 As The Mechanism Source"
description: Accepted — whitepaper_v4.pdf is the source of truth for protocol semantics; earlier papers are context only and their aggregate-matching ideas are out of scope
sources:
  - protocol/docs/adr/0002-treat-whitepaper-v4-as-mechanism-source.md
updated: 2026-07-07
---

# ADR 0002: Treat Whitepaper V4 As The Mechanism Source

**Status: Accepted.**

## Decision

Use `documents/whitepaper_v4.pdf` as the source of truth for protocol
semantics. Earlier whitepaper versions are context only. See
[mechanism whitepaper](../concepts/mechanism-whitepaper.md).

## Context

The repository contains multiple whitepaper versions. Earlier versions carry
useful lifecycle and architecture ideas but also older clearing approaches
that v4 supersedes.

## Consequences

- The implementation follows virtual LMSR receipts over exact path intervals
  and deterministic band-pass clearing
  ([graduation clearing](../concepts/graduation-clearing.md)).
- Explicitly out of scope unless a future whitepaper revision **and** ADR
  change the mechanism: aggregate share matching, aggregate collateral
  matching, and receipt-average partial fills.

This ADR is restated by the [Constitution](protocol-constitution.md), which
adds the identifying citation (rev. 0.4, June 2026) and notes that v4
supersedes earlier papers' aggregate matching and price-bucket ideas.

## Related pages

- [Market lifecycle](../concepts/market-lifecycle.md)
- [Summary: Constitution](protocol-constitution.md)
- [Summary: protocol context glossary](protocol-context.md)
