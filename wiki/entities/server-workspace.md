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
  - docs/portfolio-data-design.md
updated: 2026-07-14
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
4. **Clearing keeper** (`src/keeper/`) — the band-pass graduation clearing pass;
   see [clearing keeper](clearing-keeper.md). Built, but poll-based and still
   gated to the local network.

Tables: `markets` (keyed chain_id+market_id, starts `under_review`),
`market_metadata`, append-only `market_ai_reviews`, durable
`market_ai_review_jobs`. viem client factories centralized in
`src/blockchain/client.ts`.

## Hardening gaps (all open, [root ADR 0009](../summaries/root-adr-0009-server-api-hardening.md))

Admin/dev endpoints gated only by env flags (`POPCHARTS_ADMIN_REVIEW_ENABLED`,
`POPCHARTS_DEV_TOOLS_ENABLED`); no rate limiting; no search endpoint; planned
user auth is likely SIWE-style wallet signatures.

**There is no shared "operator auth" coming, and an older version of this page
said there was.** The 2026-07-09 correction to root ADRs 0009/0011/0012/0015 is
the opposite: operator actions — manual re-review, graduation triggering, market
cancellation, resolution override — **never go through the deployed API at all**.
Dev/admin endpoints are excluded from production builds, and operators act
locally with the operator key. So the gap here is *removing* those surfaces from
prod, not authenticating them.

The portfolio gap is **closed**: the
[portfolio data design](../summaries/portfolio-data-design.md) landed as PRs
#151–#154 — one aggregate `GET /portfolio/:chainId?owner=` (unauthenticated
owner-scoped read, same pattern as `orders?owner=`) over receipts ⋈ settlement,
per-wallet `outcome_token_balances`, and open `venue_orders`. True PnL remains
deferred. That doc is also where the repo-wide **money paper trail** invariant
now lives: every value transfer leaves an immutable, receipt-linked DB row
sourced from an on-chain event, never inferred.

## Related pages

- [Deployment and infrastructure](../concepts/deployment-and-infrastructure.md) — ECS shape
- [Market lifecycle](../concepts/market-lifecycle.md) — the projection it serves
- [Monorepo architecture](../concepts/monorepo-architecture.md) — why it's outside the workspace
