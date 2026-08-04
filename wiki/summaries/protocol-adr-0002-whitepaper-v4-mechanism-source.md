---
type: summary
title: "ADR 0002: Treat The Whitepaper As The Mechanism Source"
description: Accepted, amended 2026-08-04 — the source is now the newest in-repo revision (whitepaper/v0.6.md), not the v4 PDF; earlier papers are context only and their aggregate-matching ideas are out of scope
sources:
  - protocol/docs/adr/0002-treat-whitepaper-v4-as-mechanism-source.md
updated: 2026-08-04
---

# ADR 0002: Treat Whitepaper V4 As The Mechanism Source

**Status: Accepted.** Amended 2026-08-04: the source moved from the v4 PDF to
the in-repo markdown, and the current revision is v0.6. The ADR filename keeps
its original `v4` slug as a historical record.

## Decision

Use the newest revision in [`whitepaper/`](../../whitepaper/README.md) as the
source of truth for protocol semantics — currently
[`whitepaper/v0.6.md`](../../whitepaper/v0.6.md). Earlier revisions and the
PDFs in `documents/` are context and published artifacts, not authority. See
[mechanism whitepaper](../concepts/mechanism-whitepaper.md).

The amendment adds a process rule: a mechanism change lands as a new revision
**plus** an ADR, and either one without the other is a defect. It also carries a
revision-lineage table (v0.6 withdrawals/fees → v0.5 the unpublished proof
rewrite → v0.4 = `whitepaper_v4.pdf` → v0.3 → v0.1) for reading old code.

## Context

The repository contains multiple whitepaper versions. Earlier versions carry
useful lifecycle and architecture ideas but also older clearing approaches that
later revisions supersede. Until 2026-08 the paper existed only as a PDF, with
its markdown source in a separate repository, so the source of truth could not
be reviewed in the same diff as the code it governs.

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
