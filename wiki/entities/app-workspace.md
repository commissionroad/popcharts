---
type: entity
title: app/ workspace
description: The Next.js App Router frontend — domain-first module layout, Privy auth, designkit-derived Tailwind v4 tokens, and adapter-only integrations.
sources:
  - app/README.md
  - app/CONTEXT.md
  - app/docs/adr/0001-frontend-framework.md
  - app/docs/adr/0003-domain-first-module-layout.md
  - app/docs/adr/0005-code-quality-and-dependency-policy.md
  - docs/architecture.md
  - docs/adr/0013-app-feature-completion.md
updated: 2026-07-07
---

# app/ workspace

Next.js App Router app (React/TypeScript, Server Components by default,
interactive client islands), route tree at `app/src/app`.

## Module boundaries ([app ADR 0003](../summaries/app-adr-0003-domain-first-module-layout.md))

- `src/domain/` — pure TS, no React/Next/browser/wallet/contract imports;
  whitepaper vocabulary is the mandatory shared language.
- `src/features/` — vertical slices; `src/components/` — shared UI
  (12 components, 8 adapted from [designkit](designkit.md); see
  [component inventory](../summaries/app-component-inventory.md)).
- `src/integrations/` — adapters only (wallet/contracts/indexer/analytics):
  parse external data into typed shapes, no domain logic. ABIs have one home
  (`src/integrations/contracts/`, fed by `@popcharts/protocol`); the generated
  api-client is consumed only through `src/integrations/indexer/markets-api.ts`
  and mapped to domain types at one seam.
- Floating-point LMSR replica in `src/domain/lmsr/lmsr.ts` for UI previews —
  advisory only; the settling math is Solidity `LmsrMath.sol`.

## Auth, data, config

- Privy with `loginMethods: ["email","google","wallet"]`; wallet SDK confined
  to `src/integrations/wallet/`. Note: [app ADR 0005](../summaries/app-adr-0005-code-quality-and-dependency-policy.md)
  requires an ADR for wallet-orchestration dependencies, but no Privy ADR
  exists — flagged for lint.
- Market data source modes `auto`/`api`/`fixtures` via
  `POPCHARTS_MARKET_DATA_SOURCE` + `POPCHARTS_INDEXER_API_URL`; local chain
  enabled by `NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN=true`.
- Deployed via Vercel GitHub integration, project root `app`, production on
  `main` ([deployment](../concepts/deployment-and-infrastructure.md)).

## Status

Pregrad journey is polished (discovery, market detail with AI evidence,
create flow, receipts, portfolio); everything post-graduation is missing —
tracked in [root ADR 0013](../summaries/root-adr-0013-app-feature-completion.md)
(14 open items). CI gates on every app PR: lint, typecheck, unit,
e2e-smoke ([app ADR 0004](../summaries/app-adr-0004-testing-and-ci-gates.md)).

## Related pages

- [Market lifecycle](../concepts/market-lifecycle.md) — product status ladder
- [Product honesty rule](../concepts/product-honesty-rule.md) — copy contract
- [Monorepo architecture](../concepts/monorepo-architecture.md) — import rules
