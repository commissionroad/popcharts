---
type: summary
title: Server README
description: Bun/Elysia API + viem indexer workspace — local setup, AI review service and runner, local chain smoke, indexed PregradManager events, and key endpoints
sources:
  - server/README.md
updated: 2026-07-07
---

# Server README

`server/README.md` documents the backend workspace: a **Bun/Elysia API
server** and a **viem event indexer**, with Drizzle ORM over PostgreSQL and
generated OpenAPI docs served at `/openapi`. The API defaults to
`http://localhost:3001`. The indexer runs as a second process and needs
`ARC_TESTNET_PREGRAD_MANAGER_ADDRESS`. See
[server workspace](../entities/server-workspace.md) and
[indexer](../entities/indexer.md).

## Indexed events and endpoints

The indexer watches [PregradManager](../entities/pregrad-manager.md) market
creation, review, receipt, and settlement events, writing raw event rows and
updating the market projection from chain events — including
`GraduationStarted`, `ClearingRootSubmitted`, `GraduationFinalized`,
`MarketRefundsAvailable`, and receipt claim/refund events (the on-chain trace
of [graduation clearing](../concepts/graduation-clearing.md)).

- `GET /markets` — at most 200 markets, newest first; ISO `since` cursor for
  incremental fetches.
- `POST /markets/:chainId/:marketId/graduate` — **non-mutating** eligibility
  and status check. A `graduated` response means the indexer already saw
  `GraduationFinalized` on-chain; eligible bootstrap markets still need the
  graduation manager to run start/root/finalize transactions.
- `POST /dev/markets/:chainId/:marketId/close` — local-dev only
  (`POPCHARTS_DEV_TOOLS_ENABLED=true` and `NETWORK=local`); fast-forwards the
  local chain to the graduation deadline and calls
  `PregradManager.markRefundable`.

## AI review service

A separate local HTTP server (default `http://localhost:3002`) for market
moderation and knowability checks — see
[AI review service](../entities/ai-review-service.md) and
[AI-assisted resolution](../concepts/ai-assisted-resolution.md). Providers:

- **Ollama** (e.g. `gpt-oss:20b`) — local models don't browse; the service
  fetches safe public evidence first and passes it as untrusted context.
  Localhost, private IPs, non-HTTP URLs, oversized fetches, and unsafe
  redirects are blocked.
- **Anthropic** (`AI_REVIEW_PROVIDER=anthropic`) — calls the Messages API
  with native `web_search`/`web_fetch` tools, capped by
  `AI_REVIEW_ANTHROPIC_MAX_WEB_*`. Hard-block heuristics still run first.
- **Heuristic** (`AI_REVIEW_PROVIDER=heuristic`) — no-model smoke mode.

`AI_REVIEW_INTERNET_ACCESS` can be `off` or `provided_urls` to restrict
evidence collection.

## AI review runner

A third process, distinct from both indexer and review service. It polls
Postgres for eligible `under_review` markets, leases review jobs, calls the
review service, persists `market_ai_reviews`, and applies **guarded on-chain
market status transitions** before the SQL projection can move to `bootstrap`
or `rejected` — the review gate in the
[market lifecycle](../concepts/market-lifecycle.md). Outside local dev it
signs with `POPCHARTS_REVIEW_MANAGER_PRIVATE_KEY`; local dev falls back to
`POPCHARTS_DEVCHAIN_PRIVATE_KEY`, then the default local account. Operators
can enqueue jobs via
`POST /admin/markets/:chainId/:marketId/review` only when
`POPCHARTS_ADMIN_REVIEW_ENABLED=true` (disabled by default; enqueue-only).
`bun run smoke:ai-review-runner` exercises the full DB→service→DB path with
the heuristic provider (default port 3012).

## Local orchestration

From the repo root: `just local-dev` starts the full local app stack plus AI
review service and runner in heuristic mode; `just local-ai-review` starts
just Postgres + review service + runner. `just setup && just local-smoke`
runs the full local chain smoke: docker-compose Postgres, local protocol
contracts on a Hardhat node ([devchain](../entities/devchain.md)), generated
`server/.env.local-chain`, API + indexer, market creation, and verification
that `GET /markets?chainId=31337` returns the indexed market
(`--keep-running` to inspect afterwards).

## Related pages

- [Server workspace](../entities/server-workspace.md)
- [Deployment and infrastructure](../concepts/deployment-and-infrastructure.md)
- [Summary: infra readme](infra-readme.md)
