---
type: summary
title: App README
description: Frontend workspace overview — Next.js/Tailwind stack, Privy wallet config, indexer API data-source modes, dev-tools flags, product shape, and src/ structure
sources:
  - app/README.md
updated: 2026-07-07
---

# App README

`app/README.md` orients contributors to the production frontend: Next.js App
Router, TypeScript, Tailwind CSS v4, and the Pop Charts design system. Core
commands are `pnpm dev`, `lint`, `typecheck`, `test:unit`, `test:e2e:smoke`,
and `build` — matching the CI gates in
[app ADR 0004](app-adr-0004-testing-and-ci-gates.md).

## Wallet configuration

The app uses **Privy** for email, Google, embedded-wallet, and external EVM
wallet login (`NEXT_PUBLIC_PRIVY_APP_ID`, optional
`NEXT_PUBLIC_PRIVY_CLIENT_ID`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, and an
injected-wallet fallback flag). Users without a wallet get an Ethereum
embedded wallet. All wallet SDK usage is confined to
`src/integrations/wallet/` so Solana support could be added there later
without touching domain modules. The wallet network list is **Arc
Testnet-only** unless `NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN=true` enables
the local Hardhat chain (see [devchain](../entities/devchain.md)).

## Market data source

Market discovery reads from the read-only server/indexer API
(`POPCHARTS_INDEXER_API_URL`, default local `http://localhost:3001`).
`POPCHARTS_MARKETS_CHAIN_ID` (example value `5042002`) filters `GET /markets`
and bare ids. `POPCHARTS_MARKET_DATA_SOURCE` selects `auto` (API when the URL
is set, fixtures otherwise), `api` (require the server), or `fixtures` (force
fixture-backed reads for local tests/demos). See
[server workspace](../entities/server-workspace.md) and
[indexer](../entities/indexer.md).

Dev-only surfaces are double-gated: market-page dev settings need
`NEXT_PUBLIC_POPCHARTS_DEV_TOOLS_ENABLED=true`, and the matching server close
endpoint additionally requires `POPCHARTS_DEV_TOOLS_ENABLED=true` plus
`NETWORK=local` on the server side.

## Product shape

Pop Charts starts where a Polymarket-style venue cannot: **before** a market
has real liquidity. Users browse markets, launch binary markets, place
pre-graduation receipts on a virtual LMSR curve, watch matched liquidity build
toward graduation, and inspect which price bands clear into backed YES/NO
complete sets. After graduation the model becomes familiar (fixed-payout
outcome tokens, trading panels, positions, resolution); before graduation the
app must be *more explicit* than a normal prediction market — receipts are
priced intents, fills are partial and not guaranteed, unmatched segments
refund at exact path cost. See
[market lifecycle](../concepts/market-lifecycle.md).

## Structure

`src/app/` (routes), `src/components/` (shared UI/layout/charts),
`src/design-system/` (tokens + global styling), `src/domain/` (pure TS market,
LMSR, receipt, clearing logic), `src/features/` (product flows),
`src/integrations/` (wallet, contracts, indexer, analytics boundaries),
`src/lib/` (helpers), `src/tests/e2e/` (Playwright). The README instructs
reading `CONTEXT.md` ([summary](app-context.md)) before naming domain types or
user-facing states.

## Related pages

- [App workspace](../entities/app-workspace.md)
- [Summary: app ADR 0001 — frontend framework](app-adr-0001-frontend-framework.md)
- [Summary: app ADR 0003 — domain-first module layout](app-adr-0003-domain-first-module-layout.md)
