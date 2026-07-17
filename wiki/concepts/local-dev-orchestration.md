---
type: concept
title: Local dev orchestration
description: The just/manifest-driven local stacks — local-dev, local-smoke, devchain-e2e, ai-review — and the rule that orchestrators read deployment manifests, never stdout.
sources:
  - README.md
  - docs/devchain.md
  - docs/architecture.md
  - server/README.md
  - docs/adr/0020-concurrent-local-dev-stacks.md
updated: 2026-07-17
---

# Local dev orchestration

Cross-workspace local stacks are wired by root `just` recipes and root
`scripts/` (spawn-only glue — no business logic). The load-bearing
convention: **orchestrators read deployment manifests
(`protocol/deployments/*.local.json`), never stdout.**

## The stacks

- `just dev` — app-only default.
- `just local-dev` — full stack via Process Compose (control plane
  `local-dev.control-plane.yaml`): [devchain](../entities/devchain.md) +
  contracts + Postgres + indexer + API + app. Runs from the primary checkout.
- `just local-smoke` — create→index→API verification
  (`GET /markets?chainId=31337`).
- `just devchain-e2e` — chain-backed Playwright `@chain` smoke.
- `just local-ai-review` / `just server-ai-review-smoke` — AI review loop on
  port 3002/3012 (Ollama by default locally, heuristic fallback).
- Postgrad venue local deploy + `just local-market-health` /
  `just local-market-smoke` — the four venue flows.
- `just local-create-market` — emits canonical JSON metadata in the
  `MarketCreated` event so the indexer verifies metadata with no app POST;
  local markets resolve in 2h with a 1h graduation deadline.

## Env seams

`server/.env.local-chain` (generated), `app/.env.development.local`
(gitignored; deterministic local key for the dev-only creation route),
`NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN`, `NETWORK=local`,
`POPCHARTS_MARKET_DATA_SOURCE=auto|api|fixtures`. Dev-only server endpoints
need `POPCHARTS_DEV_TOOLS_ENABLED=true` + `NETWORK=local`.

## Concurrent stacks (slot model, ADR 0020)

Historically every stack pinned the same four resources — chain RPC `:8545`,
the generated `server/.env.local-chain`, the `popcharts` database, and
process-compose admin `:8080` — so a second stack silently collided with the
first (see [Repo ADR 0020](../summaries/root-adr-0020-concurrent-local-dev-stacks.md)).
Stacks are becoming slot-addressed **instances**: each claims a slot (0 = a
human on the primary checkout, 1..n = agents in `.claude/worktrees/`, then
auto-offset), and every resource derives from it — chain port `8545 + 10·slot`,
API `3001 + 10·slot`, app `3000 + 10·slot`, admin `8080 + slot`, database
`popcharts_<slot>`, env file `.env.local-chain.<slot>`. Slot 0 keeps today's
exact values. A home-dir registry (`~/.popcharts/local-stacks/`) tracks running
stacks; a chain is reused only when a live registry entry for the same instance
owns it (foreign chains fail loudly instead of being adopted); Postgres is
isolated per slot at the **database** level inside the one shared container;
and `local-create-market` (and siblings) resolve which stack to target from the
registry. chainId stays 31337 across slots — it only matters for a browser
wallet on two stacks at once. Phase 1 (the slot/registry core) landed
2026-07-17; the control-plane wiring, database-scoped reset, and stack-aware
scripts follow.

## Related pages

- [Testing strategy](testing-strategy.md) — what each tier proves
- [Devchain](../entities/devchain.md) — the chain underneath
- [Repo ADR 0020](../summaries/root-adr-0020-concurrent-local-dev-stacks.md) — the concurrent-stack slot model
