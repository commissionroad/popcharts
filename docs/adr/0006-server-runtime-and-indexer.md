# ADR 0006: Use Bun And Elysia For The Server

Status: Accepted

Date: 2026-06-13

## Context

Pop Charts needs an API server and chain indexer for market creation events and
future receipt/graduation projections. The sibling CommissionRoad repository
already proved a useful backend shape: Elysia routes with generated OpenAPI,
Drizzle/PostgreSQL persistence, and a viem event indexer that recovers missed
logs before starting live watchers.

The existing Pop Charts app and protocol packages use pnpm and Node-oriented
tooling. The protocol package depends on Hardhat 3, whose documented support is
for Node.js. The server can choose its own runtime without forcing a repo-wide
package-manager migration.

## Decision

Use Bun and Elysia in `server/`.

The initial server package owns:

- An Elysia API with generated OpenAPI documentation.
- Drizzle schema and migrations for PostgreSQL.
- Network and contract configuration for local, Base Sepolia, and Base.
- A viem indexer that watches `PregradManager.MarketCreated`.
- Raw event tables plus API projection tables.
- Read-only market APIs that serve indexed chain data to the frontend.
- A non-mutating graduation request stub for a future server-mediated
  transaction flow.

Do not convert `app/` or `protocol/` to Bun in this slice. Keep their existing
pnpm workflows intact.

## Consequences

Positive:

- API schemas stay runtime-validating, TypeScript-readable, and OpenAPI-ready.
- The server can run TypeScript directly during local development.
- Pop Charts gets CommissionRoad-style generated API docs without replacing the
  app or protocol toolchains.
- Drizzle tables make the indexer and API share one typed persistence contract.

Tradeoffs:

- The repo now uses both pnpm and Bun.
- Bun runs TypeScript files but does not replace `tsc --noEmit`; explicit
  typecheck scripts remain required.
- The first indexer event ABI is declared in the server until the protocol
  package exports generated ABIs and deployed addresses.

## Follow-Up

- Export generated contract ABIs and deployment addresses from `protocol/`.
- Replace app fixture market queries with the server API.
- Add `ReceiptPlaced` indexing after market creation is stable.
- Decide where full market metadata is fetched from once the protocol metadata
  hash points at a durable source.
- Add a generated API client once frontend integration begins.
