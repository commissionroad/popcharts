---
type: concept
title: Monorepo architecture
description: Acyclic workspace graph with coupling only via @popcharts/protocol, committed generated artifacts, or the network — plus the intentional-duplication doctrine.
sources:
  - docs/architecture.md
  - docs/adr/0016-monorepo-architecture-cleanup-program.md
  - docs/adr/0006-server-runtime-and-indexer.md
updated: 2026-07-13
---

# Monorepo architecture

Certified healthy 2026-07-06 by the [cleanup program audit](../summaries/root-adr-0016-monorepo-architecture-cleanup-program.md):
the debt was file-level, not structural.

## The contract

- Workspaces couple **only** via `@popcharts/protocol`, committed generated
  artifacts, or the network. The graph is acyclic:
  [protocol](../entities/protocol-workspace.md) imports nothing;
  [server](../entities/server-workspace.md) imports nothing from workspaces
  (inline `parseAbi`); [app](../entities/app-workspace.md) consumes protocol
  metadata and the generated api-client through single adapter seams.
- Two generation pipelines, each with a committed output and a `--check` CI
  twin: contract metadata (`metadata:check`) and OpenAPI → orval api-client
  (`openapi:check` / `api:check`).
- Dual toolchain by decision ([root ADR 0006](../summaries/root-adr-0006-server-runtime-and-indexer.md)):
  Bun for server; pnpm workspace (one root lockfile) for app + protocol +
  packages; `infra/` on CDK; root `scripts/` and the `justfile` are
  spawn-only glue.
- Escape hatch: changes that don't fit the rules require an ADR, not
  boundary-bending.

## Intentional duplication doctrine (do not "fix")

- `MarketStatus` — three definitions, three masters (Solidity enum, API
  union, app domain type). See [market lifecycle](market-lifecycle.md).
- LMSR math — canonical fixed-point `LmsrMath.sol` (settles) vs advisory
  float replica in the app (previews). No automated parity check; advisory
  only.

## Staleness

The root README still describes nested `app/`/`protocol/` lockfiles;
`docs/architecture.md` (post-ADR-0007) records the single root lockfile —
README is behind, and the Vercel install recipe for `rootDirectory: app`
deserves verification. Cleanup Tracks A/B/D/E/F executed 2026-07-06..07;
Track C (contract decomposition) remains open pending human review.
