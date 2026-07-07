---
type: entity
title: server/ workspace
description: Bun + Elysia read API, viem indexer, and AI review service/runner over Drizzle/PostgreSQL — intentionally outside the pnpm workspace.
sources:
  - server/README.md
  - docs/adr/0006-server-runtime-and-indexer.md
  - docs/adr/0009-server-api-hardening.md
  - docs/architecture.md
  - docs/ai-review-runner-design.md
updated: 2026-07-07
---

# server/ workspace

Bun runtime + Elysia + Drizzle/PostgreSQL + viem
([root ADR 0006](../summaries/root-adr-0006-server-runtime-and-indexer.md)
chose Bun deliberately while app/protocol stay pnpm/Node — Hardhat 3 pins the
protocol to Node). Outside the pnpm workspace (`bun.lock`); produces
artifacts for others (openapi.json → orval api-client) but imports nothing
from them — chain knowledge is inline `parseAbi` fragments plus config
addresses.

## Processes

One Docker image, entrypoint-selected:
1. **API** (`src/api/`, port 3001) — deliberately read-only projection over
   indexed events; writes limited to metadata, review jobs, operator actions.
   OpenAPI at `/openapi`; `/health`, `/version`. `GET /markets` capped at 200
   (`MARKET_LIST_LIMIT`), `since` cursor. API status vocabulary is a TypeBox
   snake_case union; chain `Active` maps to `"bootstrap"`, `Frozen` unexposed.
2. **Indexer** (`src/indexer/`) — see [indexer](indexer.md).
3. **AI review runner** (`src/ai-review-runner/`) + the separate **AI review
   service** (`src/ai-review/`, port 3002) — see [AI review service](ai-review-service.md).

Tables: `markets` (keyed chain_id+market_id, starts `under_review`),
`market_metadata`, append-only `market_ai_reviews`, durable
`market_ai_review_jobs`. viem client factories centralized in
`src/blockchain/client.ts`.

## Hardening gaps (all open, [root ADR 0009](../summaries/root-adr-0009-server-api-hardening.md))

Admin/dev endpoints gated only by env flags (`POPCHARTS_ADMIN_REVIEW_ENABLED`,
`POPCHARTS_DEV_TOOLS_ENABLED`); no rate limiting; no portfolio/postgrad/search
endpoints; planned user auth is likely SIWE-style wallet signatures. Operator
auth is meant to land once, in the server package, shared by review/resolution
admin surfaces (root ADRs 0009/0011/0012).

## Related pages

- [Deployment and infrastructure](../concepts/deployment-and-infrastructure.md) — ECS shape
- [Market lifecycle](../concepts/market-lifecycle.md) — the projection it serves
- [Monorepo architecture](../concepts/monorepo-architecture.md) — why it's outside the workspace
