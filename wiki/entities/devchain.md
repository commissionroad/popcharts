---
type: entity
title: Devchain (local Hardhat chain)
description: The local proving ground — chainId 31337 Hardhat node with manifest-driven deploys of the full pregrad + postgrad stack; every vertical's exit criteria run here first.
sources:
  - docs/devchain.md
  - README.md
  - server/README.md
  - docs/adr/0007-track-verticals-with-progress-adrs.md
updated: 2026-07-14
---

# Devchain

Local Hardhat node (chainId 31337) plus deterministic deploy scripts. Every
exit criterion runs here before any public deployment: full-lifecycle e2e
(root ADR 0014), forced-reorg convergence via snapshot/revert (0010),
resolution smoke (0012), time travel past `graduationTime`/`resolutionTime`.
The pregrad loop was verified working end to end here as of the July 2026
audit.

## Flows

- `pnpm run devchain:e2e`: node (reused if already on 127.0.0.1:8545) →
  `deploy-devchain.ts` → MockCollateral + PregradManager →
  `protocol/deployments/devchain.local.json` → app env block → Playwright
  `@chain` smoke. Orchestrators read deployment manifests, never stdout.
- Full postgrad venue deploys locally too: venue stack (PoolManager,
  StateView, V4Quoter, MinimalV4SwapRouter) → `local.venue-stack.local.json`,
  then PoolTickBounds/order manager/CREATE2-mined hook/adapter →
  `local.postgrad.local.json`, plus a demo complete-set market (`PCSM`) and
  four smoke flows: maker order, taker swap, complete-set arbitrage,
  resolution. Permit2 `transferApproval` is optional on devchains that don't
  seed it.
- `just setup && just local-smoke` covers create→index→API
  (`GET /markets?chainId=31337`).

## Config

Env knobs: `POPCHARTS_RPC_URL`, `POPCHARTS_DEPLOYER_PRIVATE_KEY`,
`POPCHARTS_DEPLOYMENT_FILE`, `POPCHARTS_APP_ENV_FILE`,
`POPCHARTS_WRITE_APP_ENV`. The deterministic local key also powers the
dev-only market-creation API route (`app/.env.development.local`,
gitignored). Never `POPCHARTS_DEVCHAIN_ENABLED=true` in production; the
devchain key is Preview-scoped only. Local markets resolve in two hours with
a one-hour graduation deadline.

## Related pages

- [Local dev orchestration](../concepts/local-dev-orchestration.md)
- [Testing strategy](../concepts/testing-strategy.md)
- [Postgrad v4 venue](postgrad-v4-venue.md) — deployed locally in full
