---
type: summary
title: Server README
description: Bun/Elysia API + viem indexer workspace — local setup, AI review service and in-process draft-review runner (codex-cli by default), local chain smoke, indexed PregradManager events, and key endpoints
sources:
  - server/README.md
updated: 2026-08-06
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
- **Claude CLI** (`AI_REVIEW_PROVIDER=claude-cli`) — drives Claude Code on the
  host in headless print mode; the model browses for itself, fetching pages
  from this host.
- **Codex CLI** (`AI_REVIEW_PROVIDER=codex-cli`) — drives Codex on the host
  non-interactively. Its web search runs on the provider's servers, so the
  review host needs egress only to the Codex API. The model is pinned, because
  the CLI otherwise resolves a default from a server-side catalogue.
- **Heuristic** (`AI_REVIEW_PROVIDER=heuristic`) — explicit no-model smoke mode
  and the deterministic hard-flag gate that runs before model work.

`AI_REVIEW_INTERNET_ACCESS` can be `off` or `provided_urls` to restrict
evidence collection.

**Default provider is Codex CLI** (changed 2026-07-29; Claude CLI from
2026-07-25, Ollama before that): `just local-dev` starts the real agent-based
path rather than the heuristic. The stock local timing is five
minutes for the model call, six for the runner request, and ten for the DB
lease. Transient provider failures return a retryable response, keep the market
pending, and do not persist a heuristic review or scorecard. Completed reviews
store one rationale per score. Hard-flag rejects from the heuristic gate remain
final before model work; explicit heuristic mode remains available for smoke.

## Draft review runner

**Not a separate process.** Review moved onto drafts under
[ADR 0022](root-adr-0022-review-first-market-creation.md), and the API server
hosts the runner in-process: it claims draft-review jobs, calls the review
service, and records the verdict on the draft. An approved draft becomes
publishable and markets are born `Active`, so there is no on-chain review gate
in the [market lifecycle](../concepts/market-lifecycle.md) any more.

Signing the publish authorization needs
`POPCHARTS_MARKET_CREATION_AUTHORIZER_PRIVATE_KEY`; local dev (`NETWORK=local`)
falls back to a built-in dev account, so only shared deployments set it.

A parked draft lands in `changes_requested`, which the creator edits and
resubmits — there is no operator review path.

## Local orchestration

From the repo root: `just local-dev` starts the full local app stack plus AI
review service and runner on the **codex-cli** provider (pending retries, see
above); `just local-ai-review` starts just Postgres + review service + runner. `just setup && just local-smoke`
runs the full local chain smoke: docker-compose Postgres, local protocol
contracts on a Hardhat node ([devchain](../entities/devchain.md)), generated
`server/.env.local-chain`, API + indexer, market creation, and verification
that `GET /markets?chainId=31337` returns the indexed market
(`--keep-running` to inspect afterwards).

## Related pages

- [Server workspace](../entities/server-workspace.md)
- [Deployment and infrastructure](../concepts/deployment-and-infrastructure.md)
- [Summary: infra readme](infra-readme.md)
