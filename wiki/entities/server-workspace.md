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
updated: 2026-07-15
---

# server/ workspace

Bun runtime + Elysia + Drizzle/PostgreSQL + viem
([root ADR 0006](../summaries/root-adr-0006-server-runtime-and-indexer.md)
chose Bun deliberately while app/protocol stay pnpm/Node — Hardhat 3 pins the
protocol to Node). Outside the pnpm workspace (`bun.lock`); produces
artifacts for others (openapi.json → orval api-client) and consumes
`@popcharts/protocol` through a `file:../protocol` dependency (venue ABIs,
price/tick helpers, clearing math, manifest types — used by the keeper, venue
services, and the venue-pool registry). Pregrad indexer watchers keep inline
`parseAbi` fragments for the events they watch; addresses come from config.

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
4. **AI resolution runner** (`src/ai-resolution-runner/`) + the separate **AI
   resolution service** (`src/ai-resolution/`) — the post-graduation sibling of
   AI review; see [AI-assisted resolution](../concepts/ai-assisted-resolution.md).
5. **Clearing keeper** (`src/keeper/`) — the band-pass graduation clearing pass;
   see [clearing keeper](clearing-keeper.md). Built, but poll-based and still
   gated to the local network.

Tables: `markets` (keyed chain_id+market_id, starts `under_review`),
`market_metadata`, append-only `market_ai_reviews`, durable
`market_ai_review_jobs`. viem client factories centralized in
`src/blockchain/client.ts`.

## Live-updates relay (built 2026-07-22, [root ADR 0021](../summaries/root-adr-0021-live-market-updates.md))

The API gains a sixth responsibility: an **SSE endpoint** (`GET /events`) that
pushes live market updates to the browser. Because the API is the long-lived
process that holds client connections (the indexer can't — separate process), it
runs the **relay**: it tails a durable `change_feed` outbox table (written by an
explicit `recordLiveChange` seam in the same transaction as each indexed event,
not a DB trigger), maps each row `source_table → SSE channel + React Query key`
in TypeScript, and fans out a signal-to-refetch nudge; browsers refetch the
existing read endpoints (DB/REST stays the single source of truth). Reconnect
resumes via `Last-Event-ID` = the last `change_feed.id`. The relay is
ref-counted (polls only while a client is connected) and each autoscaled API
instance runs its own over the shared table — no Redis. Wake mechanism is
poll-first (NOTIFY optional). Deployment
pieces (SSE behind the ALB, cross-origin CORS, RDS-Proxy connection handling)
belong to [ADR 0015](../summaries/root-adr-0015-deployment-and-infrastructure.md).
Proposed, not yet built.

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
