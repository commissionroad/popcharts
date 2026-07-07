---
type: summary
title: Root README — quickstart, local stacks, and command menu
description: Repo quickstart (mise/just/pnpm), the local-dev and Process Compose stacks, local market creation, server layout, and the just command menu.
sources:
  - README.md
updated: 2026-07-07
---

# Root README

The repo root README is the operational front door: how to install tools, run
the app, and bring up progressively larger local stacks.

## What it says

- **Quickstart**: install pinned CLI tools with `mise install`, then
  `just setup` and `just dev` (or the `pnpm run` equivalents). The default dev
  server is the Next.js app in `app/` (see
  [app workspace](../entities/app-workspace.md)).
- **Full local stack** (`just local-dev`): docker-compose Postgres, Drizzle
  schema push, a Hardhat local chain, deploys of `MockCollateral` and
  [`PregradManager`](../entities/pregrad-manager.md), generated ignored env
  blocks for `server/` and `app/`, the Bun API, the
  [indexer](../entities/indexer.md), the local
  [AI Review service](../entities/ai-review-service.md) and runner, and the
  Next.js app. Market creation is wallet-signed against the local chain
  (connect an injected wallet, use `/create`). The local review service
  defaults to the heuristic provider on `http://127.0.0.1:3002`; the runner
  polls Postgres for `under_review` markets. `--no-ai-review` restores the
  older stack shape; `just local-reset` wipes the Postgres container/volumes.
- **Process Compose control plane spike** (`just local-dev-control`): the same
  bootstrap sequence (Postgres → Drizzle push → chain healthy → contracts
  deploy → env files → API/indexer/review workers/app) but with per-process
  logs, restarts, and a dependency-graph TUI. Logs also land under ignored
  `.local-dev/logs/`. Variants: `--no-ai-review`, `--ai-review-only`,
  `--keep-db`, or a single process name.
- **`just local-create-market`**: creates one extra market against the running
  local chain, loading the generated `server/.env.local-chain` so it targets
  the current local PregradManager and collateral addresses. By default it
  randomly generates a near-term market from live public sources — BTC/ETH/SOL
  spot price via CoinGecko, or city temperature via NWS hourly forecast +
  Aviation Weather Center METAR. Markets resolve in two hours with a one-hour
  graduation deadline. `--kind crypto|weather` picks a family; `--preview`
  prints metadata without creating. The helper embeds canonical JSON metadata
  directly in the `MarketCreated` event so the indexer can recover and verify
  metadata without an app metadata POST.
- **Command menu**: `just app-check` / `protocol-check` / `server-check` /
  `check` / `test` / `format`, `just devchain-e2e` (local chain deploy plus
  chain-backed Playwright smoke), `just local-smoke` (deploy local protocol,
  run server/indexer, verify `GET /markets?chainId=31337`, `--keep-running` to
  keep the stack up), `just local-ai-review`, and `just land <pr>` /
  `scripts/land` for merging PRs, fast-forwarding the base branch, and
  cleaning up worktrees/branches.
- **Lockfile note**: the app keeps `app/pnpm-lock.yaml` for the Vercel project
  rooted at `app/`, the protocol keeps its own `protocol/pnpm-lock.yaml`, and
  the server uses Bun from `server/`. (See staleness note below — the
  architecture doc describes a single root lockfile.)
- **Server**: `server/` is the Bun/Elysia API server and viem event indexer,
  using Drizzle with PostgreSQL, starting from a
  `PregradManager.MarketCreated` indexing slice
  ([server workspace](../entities/server-workspace.md)).
- **Skills**: `skills/` is the single skills tree — vendored workflows from
  `mattpocock/skills` plus local Pop Charts skills scoped to `app/`,
  `server/`, and `protocol/`.

## Related pages

- [Devchain](../entities/devchain.md) and its
  [summary](devchain.md) for the chain-backed e2e flow the README points at.
- [Testing strategy](../concepts/testing-strategy.md) — the check/smoke/e2e
  command tiers.
- [Monorepo architecture](../concepts/monorepo-architecture.md) — how the
  workspaces the commands delegate into fit together.
- [Market lifecycle](../concepts/market-lifecycle.md) — the `under_review`
  status the local runner polls for.
