# ADR 0002: Treat The Whitepaper As The Mechanism Source

## Status

Accepted. Amended 2026-08-04: the source moved from the v4 PDF to the in-repo
markdown, and the current revision is v0.6. The filename keeps its original
`v4` slug as a historical record.

## Context

The repository contains multiple whitepaper versions. Earlier versions include
useful lifecycle and architecture ideas, but they also include older clearing
approaches that later revisions supersede.

Until 2026-08 the paper existed only as a PDF in `documents/`, with its
markdown source in a separate repository. That made the source of truth
unreviewable in the same diff as the code it governs. The markdown sources and
the build pipeline now live in `whitepaper/`.

## Decision

Use the newest revision in [`whitepaper/`](../../../whitepaper/) as the source
of truth for protocol semantics — currently
[`whitepaper/v0.6.md`](../../../whitepaper/v0.6.md). Earlier revisions and the
PDFs in `documents/` are context and published artifacts, not authority.

Mechanism changes land as a new revision plus an ADR. A revision that changes
semantics without an ADR, or an ADR that changes semantics without a revision,
is a defect in either case.

## Consequences

The implementation should follow virtual LMSR receipts over exact path
intervals and deterministic band-pass clearing. Aggregate share matching,
aggregate collateral matching, and receipt-average partial fills are explicitly
out of scope unless a future revision and ADR change the mechanism.

Revision lineage, for reading old code and old ADRs:

| Revision | Published as                    | What changed                                                                                                                                                                                                  |
| -------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0.6     | —                               | Pre-graduation withdrawals (lock the overlap, Lemma 3), fees outside the solvency identity, post-graduation pool seeding. Renamed to Pop Charts. See [ADR 0014](0014-pre-graduation-withdrawals-and-fees.md). |
| v0.5     | —                               | Shortened rewrite of v0.4; replaced the informal solvency argument with Lemmas 1–2 and the exact-collateralization theorem. Never published as a PDF.                                                         |
| v0.4     | `documents/whitepaper_v4.pdf`   | The revision this ADR originally named.                                                                                                                                                                       |
| v0.3     | `documents/whitepaper_v3.pdf`   | Superseded clearing approach.                                                                                                                                                                                 |
| v0.1     | `documents/whitepaper_v0_1.pdf` | Superseded; retains resolution design later split into its own ADRs.                                                                                                                                          |
