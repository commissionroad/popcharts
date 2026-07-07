---
type: summary
title: Repo ADR 0006 — Use Bun and Elysia for the server
description: Accepted decision to build server/ on Bun + Elysia with Drizzle/Postgres and a viem indexer, keeping app/ and protocol/ on pnpm; updated for on-event canonical market metadata.
sources:
  - docs/adr/0006-server-runtime-and-indexer.md
updated: 2026-07-07
---

# Repo ADR 0006: Use Bun and Elysia for the server

**Status: Accepted** (dated 2026-06-13), with a later update on market
metadata discovery.

## Decision

Use Bun and Elysia in `server/`, mirroring the backend shape proven in the
sibling CommissionRoad repo (Elysia routes with generated OpenAPI, Drizzle/
PostgreSQL persistence, a viem event indexer that recovers missed logs before
starting live watchers). Do **not** convert `app/` or `protocol/` to Bun —
their pnpm workflows stay intact (protocol depends on Hardhat 3, which
documents Node.js support).

The initial server package owns:

- An Elysia API with generated OpenAPI documentation.
- Drizzle schema and migrations for PostgreSQL.
- Network/contract configuration for local development and Arc Testnet.
- A viem indexer watching `PregradManager.MarketCreated`.
- Raw event tables plus API projection tables.
- Read-only market APIs serving indexed chain data to the frontend.
- A non-mutating graduation request stub for a future server-mediated
  transaction flow.

## Consequences

Positive: runtime-validating, OpenAPI-ready schemas; TypeScript runs directly
in dev; indexer and API share one typed Drizzle persistence contract.
Tradeoffs: the repo uses both pnpm and Bun; Bun does not replace
`tsc --noEmit` (explicit typecheck scripts remain); the first indexer event
ABI was declared in the server pending protocol-exported ABIs.

## Follow-up items (as listed, no checkbox state)

- Export generated contract ABIs and deployment addresses from `protocol/`.
- Replace app fixture market queries with the server API.
- Add `ReceiptPlaced` indexing after market creation is stable.
- Add a generated API client once frontend integration begins.

(Several of these later landed via the monorepo cleanup program — see
[root-adr-0007-monorepo-architecture-cleanup-program](root-adr-0007-monorepo-architecture-cleanup-program.md),
Track A.)

## Update: market metadata discovery

`PregradManager.MarketCreated` now emits both `metadataHash` (the immutable
integrity commitment) and the canonical metadata JSON payload, so
contract-created markets carry canonical terms in the creation event rather
than an app side-channel. The payload may include `resolutionSources` — public
source names/URLs review agents use to corroborate evidence against resolution
criteria. The indexer records the payload on the raw event, verifies the
canonical JSON hash, and persists `market_metadata`.

## Related pages

- [../entities/server-workspace.md](../entities/server-workspace.md)
- [../entities/indexer.md](../entities/indexer.md)
- [../entities/pregrad-manager.md](../entities/pregrad-manager.md)
- [../entities/ai-review-service.md](../entities/ai-review-service.md)
- [../concepts/monorepo-architecture.md](../concepts/monorepo-architecture.md)
