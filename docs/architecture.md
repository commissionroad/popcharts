# Monorepo Architecture

This document describes the workspace dependency graph, the import rules that
keep it acyclic, where generated code lives, and the duplication that is
intentional. It records the state restored by
[ADR 0007](adr/0007-monorepo-architecture-cleanup-program.md); the server
runtime shape is decided in
[ADR 0006](adr/0006-server-runtime-and-indexer.md). When code and this
document disagree, fix one of them in the same PR.

## Workspace map

| Workspace | Owns |
| --------- | ---- |
| `app/` | The Next.js frontend. Routes (`src/app/`) compose feature components (`src/features/`) and shared components (`src/components/`); pure business logic lives in `src/domain/`; external-system adapters (contracts, indexer API client, wallet) live in `src/integrations/`; generic helpers in `src/lib/`; design tokens in `src/design-system/`. |
| `server/` | The Bun + Elysia read API (`src/api/`), the viem event indexer (`src/indexer/`), the AI review service and runner (`src/ai-review/`, `src/ai-review-runner/`), Drizzle/PostgreSQL persistence (`src/db/`), shared viem client factories (`src/blockchain/`), and config (`src/config/`). |
| `protocol/` | Solidity contracts (`contracts/`), Hardhat deployment and operations scripts (`scripts/`), the contract-metadata export pipeline, and protocol tests (`test/solidity/`, `test/nodejs/`). |
| `scripts/` | Root-level local-dev orchestration (`local-dev.ts`, `local-chain-smoke.ts`, `run-local-chain-e2e.ts`, …) plus their `scripts/shared/` helpers. These spawn workspace commands as child processes; they are glue, not a library. |
| `infra/` | AWS CDK stacks deploying the API and indexer to ECS Fargate with RDS PostgreSQL (see `infra/README.md`). Self-contained; imports no workspace source. |
| `designkit/` | Brand assets, design tokens, and component guidelines. Reference material, not a code workspace. |
| `docs/` | ADRs (`docs/adr/`), design notes, deployment docs, and verification screenshots (`docs/screenshots/`). |
| `skills/` | Engineering workflow skills (PR verification, OpenAPI sync, protocol code quality, …) used by agent sessions. |

Tooling note: `app` and `protocol` are true pnpm workspace members — one
root `pnpm install`, one root `pnpm-lock.yaml` (no nested pnpm lockfiles).
The server stays outside the workspace and installs with Bun (`bun.lock`);
it produces artifacts for the others but imports nothing from them. Shared
strictness flags live in the root `tsconfig.base.json`; shared Prettier
options in the root `.prettierrc.json`.

## Dependency graph

Cross-workspace coupling flows through the `@popcharts/protocol` workspace
package, committed generated artifacts, or over the network:

```txt
protocol/contracts/*.sol  (canonical)
  │  protocol/scripts/export-contract-metadata.ts  (runs in `protocol build`)
  ▼
protocol/src/generated/{pregrad-manager,postgrad-venue}.ts  (committed)
  │  @popcharts/protocol `workspace:*` dependency (TS source, no build step;
  │  Next transpiles it via `transpilePackages`)
  ▼
app/src/integrations/contracts/pregrad-manager.ts  (re-export shim)

server/src/api (Elysia route schemas, TypeBox)
  │  server/scripts/generate-openapi.ts  (`openapi:generate` / `openapi:check`)
  ▼
server/generated/openapi.json  (committed)
  │  orval (`app api:generate`, app/orval.config.ts)
  ▼
app/src/integrations/indexer/generated/  (committed fetch client + models)
```

The remaining edges:

- **server → chain**: the indexer and API read chain state over RPC with viem.
  All clients come from the factories in `server/src/blockchain/client.ts`
  (`createBlockchainClient`, `createReadOnlyClient`, `createWalletClient`).
  The server declares minimal inline `parseAbi`/`parseAbiItem` fragments for
  exactly the events and functions it touches (e.g.
  `src/indexer/watchers/market-created.ts`,
  `src/ai-review-runner/chain-review.ts`); it does not import protocol
  artifacts.
- **app → server at runtime**: HTTP calls through the generated fetch client,
  wrapped by the hand-written adapter
  `app/src/integrations/indexer/markets-api.ts`.
- **protocol tests → protocol scripts**: the `test/nodejs/` suites import pure
  helpers from `protocol/scripts/shared/` (protocol's own shared library), so
  script logic is unit-testable.
- **root `scripts/` → everything**: the orchestrators spawn workspace commands
  (`pnpm --dir protocol run …`, `bun run …`) and parse machine-readable
  deployment records from script output (`scripts/shared/deployments/`). They
  read; nothing imports them.

## Import rules (the acyclic contract)

- `protocol/` imports nothing from any other workspace.
- `server/` never imports protocol source or artifacts. Chain knowledge
  enters the server only as inline viem ABI fragments plus addresses from
  config/env. It never imports app code.
- `app/` never imports server source. Protocol code enters the app only
  through the `@popcharts/protocol` package (its generated contract metadata
  exports), imported solely by the re-export shims under
  `app/src/integrations/contracts/` — feature code never imports the package
  directly. Server-derived code in the app is the committed codegen output
  listed above, quarantined under `app/src/integrations/`.
- Within the app (per `app/AGENTS.md`):
  - `src/domain/` is pure TypeScript: no React, Next.js, browser APIs, wallet
    SDKs, or UI component imports. Importing `src/lib/` (pure helpers) is
    fine.
  - Route files in `src/app/` compose pages; LMSR, receipt, clearing, and
    solvency logic stays out of them.
  - ABIs have one home: `src/integrations/contracts/`. Feature components do
    not import ABIs or call `useReadContract` directly — contract reads go
    through the hooks in `src/integrations/contracts/hooks/`
    (`useTrustedCreatorStatus`, `useContractMarketStatus`). Feature service
    modules that build wallet transactions (e.g.
    `src/features/receipt-ticket/place-receipt-service.ts`) import the
    generated ABI from `integrations/contracts`, never their own copy.
  - Generated code under `integrations/indexer/generated/` is consumed only
    through the `markets-api.ts` adapter and mapped into domain types at one
    seam (`src/domain/markets/api-market.ts`).
- Root `scripts/` may spawn and observe any workspace but must stay glue:
  no workspace imports root scripts.

## Generated code and freshness gates

Every generated artifact is committed, and a check fails CI when it goes
stale relative to its source:

| Artifact (committed) | Source of truth | Regenerate | Freshness gate |
| -------------------- | --------------- | ---------- | -------------- |
| `protocol/src/generated/*.ts` | Compiled contract artifacts | `protocol build` (runs `export-contract-metadata.ts`) | `protocol metadata:check` (`export-contract-metadata.ts --check`), wired into `protocol typecheck`, so `pnpm run protocol:check` and Protocol CI enforce it |
| `server/generated/openapi.json` | Elysia route schemas | `server openapi:generate` | `server openapi:check` (regenerate-and-diff plus spec validation), wired into `pnpm run server:check` and Server CI |
| `app/src/integrations/indexer/generated/` | `server/generated/openapi.json` | `app api:generate` (orval, deterministic from the committed spec) | `app api:check` regenerates into a scratch directory and fails on any difference; wired into `app:check` and App CI, which also triggers on `server/generated/openapi.json` changes (ADR 0007 item A5). |

The pattern is uniform: hand-written code never crosses a workspace boundary;
a generator does, and a `--check` twin keeps the committed output honest.

## Intentional duplication

Two definitions are deliberately repeated across layers. Do not "deduplicate"
them.

### MarketStatus

- `protocol/contracts/types/MarketTypes.sol` — the canonical on-chain enum
  (`Active`, `Frozen`, `Graduating`, `Graduated`, `Refunded`, `Resolved`,
  `Cancelled`, `UnderReview`, `Rejected`). Its numeric values are ABI-level
  facts.
- `server/src/api/models/markets.ts` — the API vocabulary as a TypeBox union
  of snake_case strings (`"under_review" | "bootstrap" | "graduating" |
  "graduated" | "resolved" | "refunded" | "cancelled" | "rejected"`). The
  names are product-facing (`Active` becomes `"bootstrap"`) and `Frozen` is
  not exposed (reserved on chain). Indexer handlers/watchers translate chain
  events into these statuses.
- `app/src/domain/markets/types.ts` — the same string union re-declared so the
  domain layer does not depend on the generated client.

Each layer owns its definition because each answers to a different master:
Solidity to storage layout and events, the server to its public API contract,
the app to its UI domain model. Alignment is maintained by the pipelines, not
by sharing code: the ABI codegen makes chain event decoding compile-checked,
the OpenAPI spec carries the server union into the app's generated models,
and `api-market.ts` is the single seam where generated models become domain
types — a server rename breaks that mapping at typecheck time.

### LMSR math

- `protocol/contracts/libraries/LmsrMath.sol` — canonical fixed-point
  implementation; the contract's numbers are the ones that settle.
- `app/src/domain/lmsr/lmsr.ts` — a floating-point replica used for instant
  price previews and quote rendering without an RPC round-trip.

Each has its own test suite (`LmsrMath` Solidity tests,
`app/src/domain/lmsr/lmsr.test.ts`). There is no automated cross-parity
check: the app's numbers are advisory UI estimates, and any change to the
Solidity math must be mirrored in the replica deliberately.

## Adding code: where does it go?

- **A new contract, or protocol deploy/ops logic** → `protocol/`. If TS
  scripts need a new ABI, regenerate via `export-contract-metadata.ts`;
  never hand-write ABI blocks.
- **A new API endpoint or indexer projection** → `server/`. Define TypeBox
  schemas with the route, run `openapi:generate`, then `api:generate` in the
  app to pick it up.
- **App code that calls a contract** → the ABI import and any
  `useReadContract` wrapping belong in `app/src/integrations/contracts/`
  (hooks for reads); the feature keeps only orchestration.
- **Pure business rules (pricing, receipts, market shaping)** →
  `app/src/domain/` if UI-facing, Solidity if it settles funds. Never both
  without a note here.
- **A formatting/error/parsing helper used by two app features** →
  `app/src/lib/`.
- **A local-dev flow spanning workspaces** → root `scripts/`, spawning
  workspace commands. Helpers shared only within protocol scripts go in
  `protocol/scripts/shared/`.
- **Infrastructure** → `infra/`. **Docs and screenshots** → `docs/` and
  `docs/screenshots/`. **Agent workflows** → `skills/`.

When a change does not fit these rules, that is an architecture decision:
write or amend an ADR in `docs/adr/` rather than quietly bending a boundary.
