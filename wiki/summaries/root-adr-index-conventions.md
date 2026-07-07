---
type: summary
title: Repo ADR index and conventions (docs/adr/README.md)
description: Index of repository-level ADRs 0006–0015 — runtime choice, the progress-ADR process, and the eight vertical checklists tracking the Arc Testnet launch.
sources:
  - docs/adr/README.md
updated: 2026-07-07
---

# Repo ADR index and conventions

`docs/adr/README.md` catalogs repository-level decisions that belong neither
wholly to the frontend app nor the Solidity protocol. Frontend ADRs live in
`app/docs/adr/`; protocol ADRs in `protocol/docs/adr/`.

## Index as recorded

All listed ADRs carry status **Accepted**:

| ADR | Decision (one line, as indexed) |
| --- | --- |
| 0006 | Use Bun and Elysia for the server and indexer package. |
| 0007 | Track product verticals with progress ADRs and milestones M1–M5. |
| 0008 | Complete protocol functionality (clearing keeper, resolution hooks, postgrad handoff) before any deployment. |
| 0009 | Harden the API (operator auth, rate limits) and grow its lifecycle surface (search, portfolio, postgrad). |
| 0010 | Bring the indexer to testnet grade (reorgs, leasing, RPC failover) and index the postgrad lifecycle. |
| 0011 | Harden AI review for unattended operation (auth, safe evidence fetching, validation, metrics). |
| 0012 | Build AI-assisted resolution as a sibling of AI review, with abstention and operator override. |
| 0013 | Complete the app across the full market lifecycle (Google sign-in, postgrad trading, unhappy paths). |
| 0014 | Prove the full market lifespan, happy and unhappy, with an automated E2E suite. |
| 0015 | Own all CI and deployment work; deploy the protocol to Arc Testnet as the final step. |

Progress toward the Arc Testnet launch is tracked in the checklists inside
ADRs 0008–0015; ADR 0007 defines the process and milestone ordering.

## Staleness note

The README's row for 0007 points at
`docs/adr/0007-track-verticals-with-progress-adrs.md`, but a second file also
numbered 0007 exists — `docs/adr/0007-monorepo-architecture-cleanup-program.md`
(the monorepo cleanup program) — and is absent from this index. The duplicate
numbering and the missing index row are flagged in
[root-adr-0007-monorepo-architecture-cleanup-program](root-adr-0007-monorepo-architecture-cleanup-program.md).

## Related pages

- [../concepts/monorepo-architecture.md](../concepts/monorepo-architecture.md)
- [../concepts/deployment-and-infrastructure.md](../concepts/deployment-and-infrastructure.md)
- Individual summaries: [0006](root-adr-0006-server-runtime-and-indexer.md),
  [0007 process](root-adr-0007-track-verticals-with-progress-adrs.md),
  [0007 cleanup](root-adr-0007-monorepo-architecture-cleanup-program.md),
  [0008](root-adr-0008-protocol-functionality-completion.md),
  [0009](root-adr-0009-server-api-hardening.md),
  [0010](root-adr-0010-indexer-maturity.md),
  [0011](root-adr-0011-ai-review-service-hardening.md),
  [0012](root-adr-0012-ai-assisted-resolution.md),
  [0013](root-adr-0013-app-feature-completion.md),
  [0014](root-adr-0014-full-lifecycle-e2e-testing.md),
  [0015](root-adr-0015-deployment-and-infrastructure.md)
