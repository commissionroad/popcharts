---
type: summary
title: Devchain Workflow (docs/devchain.md)
description: Local Hardhat devchain e2e flow, the full postgrad venue local deployment sequence, and Arc Testnet deployment/env configuration.
sources:
  - docs/devchain.md
updated: 2026-07-07
---

# Devchain Workflow

`docs/devchain.md` documents how the app submits real protocol transactions
without leaving the fast local feedback loop, plus the Arc Testnet
configuration for non-local environments. See the
[devchain](../entities/devchain.md) entity.

## Local Hardhat chain (`pnpm run devchain:e2e`)

The e2e command: starts `hardhat node` unless one is already listening on
`http://127.0.0.1:8545`; runs `protocol/scripts/deploy-devchain.ts`; deploys
`MockCollateral` and [`PregradManager`](../entities/pregrad-manager.md);
writes `protocol/deployments/devchain.local.json`; updates the marked Pop
Charts devchain block in `app/.env.development.local`; runs the Playwright
`@chain` smoke against the Next.js app. Contracts alone can be deployed into
a running chain with `pnpm --dir protocol devchain:node` +
`pnpm run devchain:deploy`, configurable via `POPCHARTS_RPC_URL`,
`POPCHARTS_DEPLOYER_PRIVATE_KEY`, `POPCHARTS_DEPLOYMENT_FILE`,
`POPCHARTS_APP_ENV_FILE`, `POPCHARTS_WRITE_APP_ENV`.

`app/.env.development.local` is gitignored and includes the deterministic
local Hardhat private key so a development-only API route can create markets
during automated tests; manual `just local-dev` runs use wallet-signed
creation instead. The key must never be copied to a real network.

## Postgrad venue local deployment

`just local-dev` (and `local-smoke` / `devchain-e2e`) deploy the whole
system, not just pregrad. After the pregrad deploy, in order:

1. `local:deploy-venue` — self-hosted v4 venue stack (PoolManager, StateView,
   V4Quoter, MinimalV4SwapRouter) →
   `protocol/deployments/local.venue-stack.local.json`.
2. `local:deploy-postgrad` — PoolTickBounds, BoundedPoolOrderManager, the
   CREATE2-mined BoundedPredictionHook, and CompleteSetPostgradAdapter bound
   to the fresh PregradManager →
   `protocol/deployments/local.postgrad.local.json`. See
   [postgrad market](../entities/postgrad-market.md).
3. `local:create-complete-set-market` — one demo
   [complete-set](../concepts/complete-sets.md) market with pinned symbol
   `PCSM` so the venue is immediately tradeable →
   `protocol/deployments/local.market-pcsm.local.json`.

Orchestrators read these manifests (not stdout) for addresses, print them in
the ready summary, and record them in `server/.env.local-chain` and the app
env block as documentation for the upcoming server/app integration.
`--no-postgrad` skips the venue deployment. Individual pieces run via
`just local-deploy-venue`, `just local-deploy-postgrad` (needs
`POPCHARTS_PREGRAD_MANAGER_ADDRESS`), `just local-create-complete-set-market`
(needs `POPCHARTS_COLLATERAL_ADDRESS`).

Health/smoke: `just local-market-health` runs a read-only market health check
against the default `PCSM` manifest (override with `POPCHARTS_MARKET_SYMBOL`
or `POPCHARTS_MARKET_DEPLOYMENT_FILE`), exiting nonzero on a collateral
invariant violation. `just local-market-smoke` chains four protocol smoke
flows — maker order, taker swap, complete-set arbitrage, and resolution.
Resolution finalizes the market, so it must be redeployed/recreated before
trading again.

## Arc Testnet

Non-local app and server defaults point at Arc Testnet
(`NEXT_PUBLIC_POPCHARTS_CHAIN_ENV=arc-testnet`, chain ID `5042002`, RPC
`https://rpc.testnet.arc.network`). Full protocol surface deploys from
`protocol/` with `pnpm run arc:testnet:deploy` and a deployer key. The
generated Arc deployment manifest supplies the public app addresses
(`NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS`,
`NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS`) plus
`POPCHARTS_MARKETS_CHAIN_ID=5042002`.

Security rules: only `NEXT_PUBLIC_*` values reach the browser bundle; keep
`POPCHARTS_DEVCHAIN_PRIVATE_KEY` server-side and scoped to Preview; never set
`POPCHARTS_DEVCHAIN_ENABLED=true` for Production. The server/indexer also
defaults to Arc Testnet unless `NETWORK=local`; set
`ARC_TESTNET_PREGRAD_MANAGER_ADDRESS` and
`ARC_TESTNET_PREGRAD_MANAGER_DEPLOY_BLOCK` from the manifest before starting
the [indexer](../entities/indexer.md).

## Related pages

- [Testing strategy](../concepts/testing-strategy.md) — where the `@chain`
  smoke and market health/smoke commands sit in the test pyramid.
- [Deployment and infrastructure](../concepts/deployment-and-infrastructure.md)
  — Arc Testnet as the default non-local target.
- [Market lifecycle](../concepts/market-lifecycle.md) — graduation deadlines
  and resolution exercised by the smoke flows.
