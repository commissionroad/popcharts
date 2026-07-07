---
type: concept
title: Local dev orchestration
description: The just/manifest-driven local stacks — local-dev, local-smoke, devchain-e2e, ai-review — and the rule that orchestrators read deployment manifests, never stdout.
sources:
  - README.md
  - docs/devchain.md
  - docs/architecture.md
  - server/README.md
updated: 2026-07-07
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
- `just local-ai-review` / `just server-ai-review-smoke` — heuristic review
  loop on port 3002/3012.
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

## Related pages

- [Testing strategy](testing-strategy.md) — what each tier proves
- [Devchain](../entities/devchain.md) — the chain underneath
