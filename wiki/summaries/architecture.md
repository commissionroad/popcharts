---
type: summary
title: Monorepo Architecture (docs/architecture.md)
description: Workspace map, acyclic dependency graph, committed-generated-code freshness gates, and the two intentional duplications (MarketStatus, LMSR math).
sources:
  - docs/architecture.md
updated: 2026-07-13
---

# Monorepo Architecture

`docs/architecture.md` is the normative description of the workspace
dependency graph, the import rules that keep it acyclic, where generated code
lives, and duplication that is deliberate. It records the state restored by
ADR 0016 (monorepo architecture cleanup program); the server runtime shape is
decided in ADR 0006. Its self-imposed rule: when code and the document
disagree, fix one of them in the same PR.

## Workspace map

- [`app/`](../entities/app-workspace.md) — Next.js frontend with layered
  internals: routes (`src/app/`), features, shared components, pure domain
  logic (`src/domain/`), external-system adapters (`src/integrations/`),
  helpers (`src/lib/`), design tokens (`src/design-system/`).
- `packages/` — shared workspace packages; `packages/api-client/`
  (`@popcharts/api-client`) owns the committed orval-generated fetch client +
  models for the server API and its `api:check` freshness gate.
- [`server/`](../entities/server-workspace.md) — Bun + Elysia read API,
  viem event [indexer](../entities/indexer.md), the
  [AI review service and runner](../entities/ai-review-service.md)
  (`src/ai-review/`, `src/ai-review-runner/`), Drizzle/PostgreSQL persistence,
  shared viem client factories (`src/blockchain/`), config.
- [`protocol/`](../entities/protocol-workspace.md) — Solidity contracts,
  Hardhat deploy/ops scripts, the contract-metadata export pipeline, tests.
- `scripts/` — root-level local-dev orchestration glue; spawns workspace
  commands, is imported by nothing.
- `infra/` — AWS CDK stacks deploying API and indexer to ECS Fargate with RDS
  PostgreSQL; self-contained.
- [`designkit/`](../entities/designkit.md) — brand assets, design tokens,
  component guidelines; reference material, not a code workspace.
- `docs/`, `skills/` — ADRs/design docs/screenshots; agent workflow skills.

Tooling: `app`, `protocol`, and `packages/*` are true pnpm workspace members —
one root `pnpm install`, one root `pnpm-lock.yaml` (no nested lockfiles). The
server stays outside the workspace and installs with Bun (`bun.lock`); it
produces artifacts for the others but imports nothing from them. Shared
strictness lives in root `tsconfig.base.json` and `.prettierrc.json`.

## Dependency graph and import rules

Cross-workspace coupling flows only through the `@popcharts/protocol`
workspace package, committed generated artifacts, or over the network:

- **protocol → app**: contracts compile → `export-contract-metadata.ts` emits
  committed `protocol/src/generated/{pregrad-manager,postgrad-venue}.ts` →
  consumed via `@popcharts/protocol` only by re-export shims under
  `app/src/integrations/contracts/`.
- **server → app**: Elysia TypeBox route schemas →
  `server/generated/openapi.json` (committed) → orval →
  `packages/api-client/src/generated/` (committed) → consumed only through the
  hand-written adapter `app/src/integrations/indexer/markets-api.ts`.
- **server → chain**: RPC via viem client factories in
  `server/src/blockchain/client.ts`; the server declares minimal inline
  `parseAbi` fragments for exactly the events/functions it touches and never
  imports protocol artifacts.
- The acyclic contract: protocol imports nothing; server never imports
  protocol or app source; app never imports server source; feature code never
  imports the generated packages directly (shims/adapters only); within the
  app `src/domain/` stays pure TypeScript; ABIs have one home
  (`src/integrations/contracts/`) with reads going through its hooks.

## Freshness gates

Every generated artifact is committed and guarded by a `--check` twin wired
into CI: `protocol metadata:check` (in `protocol typecheck`),
`server openapi:check` (in `server:check`), and `packages/api-client
api:check` (in `app:check`, which also triggers on spec and api-client
changes — ADR 0016 item A5). Pattern: hand-written code never crosses a
workspace boundary; a generator does, and its check keeps the output honest.

## Intentional duplication — do not deduplicate

- **MarketStatus**: three deliberate definitions. Canonical on-chain enum in
  `protocol/contracts/types/MarketTypes.sol` (`Active`, `Frozen`,
  `Graduating`, `Graduated`, `Refunded`, `Resolved`, `Cancelled`,
  `UnderReview`, `Rejected` — numeric values are ABI facts); the server's
  TypeBox union of product-facing snake_case strings (`Active` becomes
  `"bootstrap"`, `Frozen` unexposed/reserved); the app domain re-declares the
  string union so `src/domain/` doesn't depend on generated code. Alignment
  is maintained by the pipelines and the single `api-market.ts` mapping seam,
  not by shared code. See [market lifecycle](../concepts/market-lifecycle.md).
- **LMSR math**: canonical fixed-point `LmsrMath.sol` (its numbers settle)
  vs. a floating-point replica in `app/src/domain/lmsr/lmsr.ts` for instant
  UI previews. Separate test suites; no automated cross-parity check —
  Solidity math changes must be mirrored deliberately.

## "Where does code go" rules

New contracts/deploy logic → `protocol/`; new endpoints/projections →
`server/` (then regenerate openapi + api-client); contract-calling app code →
`app/src/integrations/contracts/`; pure business rules → `app/src/domain/` if
UI-facing, Solidity if it settles funds — never both without a note; shared
app helpers → `app/src/lib/`; cross-workspace local-dev flows → root
`scripts/`; infra → `infra/`. Anything that doesn't fit is an architecture
decision: write or amend an ADR rather than quietly bending a boundary.

## Related pages

- [Monorepo architecture](../concepts/monorepo-architecture.md) — the concept
  page this summary feeds.
- [Deployment and infrastructure](../concepts/deployment-and-infrastructure.md)
  — `infra/` CDK stacks for API and indexer.
