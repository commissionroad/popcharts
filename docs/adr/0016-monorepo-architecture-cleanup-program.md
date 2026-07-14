# ADR 0016: Monorepo Architecture Cleanup Program

Status: Accepted — fully executed. Tracks A/B/D/E/F 2026-07-06..07 (autonomous); Track C 2026-07-07..13 with per-item human review.

Date: 2026-07-06

## Context

A full architectural review of the monorepo (2026-07-06) found that the
macro-architecture is healthy: the cross-workspace dependency graph is acyclic,
workspace boundaries are explicit, generated code is quarantined behind
adapters, and the OpenAPI pipeline gives the app a single typed source of truth
for the server API. No structural rework is needed.

The debt is concentrated at the file level, in four recurring patterns:

1. **God files/contracts.** Seven files over 500 lines accumulate mixed
   responsibilities, the worst being `protocol/contracts/PregradManager.sol`
   (1,365 lines: lifecycle + custody + fees + quoting + clearing + refunds +
   four access roles) and
   `protocol/contracts/v4/BoundedPoolOrderManager.sol` (1,273 lines: orders +
   callbacks + deferred execution + partial fills + settlement).
2. **Same-layer duplication.** Small utilities were re-implemented instead of
   shared: token formatting and `TOKEN_DECIMALS` twice in app services,
   error-message extraction three times in the app, AI-review response
   parsing/score clamping duplicated between the anthropic and ollama
   providers (a duplicated security control), inline ABIs re-declared in
   protocol scripts, and script initialization boilerplate repeated across
   ~18 protocol scripts.
3. **Boundary leaks.** App feature components import contract ABIs and call
   `useReadContract` directly; server API services construct ad-hoc viem
   clients instead of using the canonical indexer factory; and — highest risk —
   `app/src/integrations/contracts/pregrad-manager.ts` is a ~347-line
   hand-written ABI with no pipeline connecting it to
   `protocol/contracts/PregradManager.sol`, so interface drift surfaces as
   runtime transaction failures instead of build failures.
4. **Tooling inconsistency.** Five divergent tsconfigs with no shared base,
   linting present only in app and protocol, and loose verification
   screenshots cluttering the top level of `docs/`.

Duplication that is **intentional and must be preserved**: the `MarketStatus`
definitions in Solidity / server TypeBox / app domain types (each authoritative
in its layer, kept aligned by codegen and events), and the LMSR math in both
`protocol/contracts/libraries/LmsrMath.sol` (canonical) and
`app/src/domain/lmsr/lmsr.ts` (UI replica, independently tested).

## Decision

Run a tracked cleanup program of small, independent PRs — one concern per PR —
rather than a big-bang refactor. This document is the single source of truth
for scope and progress. Each item below is sized to be one PR.

Rules for executing this program:

- One checklist item per PR. Reference this ADR and the item ID in the PR
  description. Tick the checkbox in this file **in the same PR** that
  completes the item.
- Behavior-preserving refactors only, unless the item says otherwise. Every PR
  must pass the relevant workspace gate (`pnpm run app:check`,
  `pnpm run server:check`, `pnpm run protocol:check`, `pnpm run scripts:check`)
  before merge; run the full `pnpm run check` when a change touches more than
  one workspace.
- When a PR moves or extracts code, delete the old copy in the same PR. No
  transitional re-exports left behind unless an item calls for one.
- Track C (Solidity contract decomposition) touches contracts that hold funds.
  Those items require human review and must NOT be executed autonomously; an
  unattended session may prepare a design note or draft branch but must not
  merge them.
- Update the Progress Log at the bottom of this file as items land (PR number,
  date, notes/deviations).

## Work Plan

### Track A — Contract ABI pipeline and drift protection (highest value)

- [x] **A1. Export v4 contract ABIs from the protocol metadata pipeline.**
  Extend `protocol/scripts/export-contract-metadata.ts` to also generate
  TypeScript ABI modules for `BoundedPoolOrderManager`,
  `BoundedPredictionHook`, `MinimalV4SwapRouter`, and `PoolTickBounds` into
  `protocol/src/generated/`, re-exported from `protocol/src/index.ts`.
  Generation must stay deterministic (sorted contracts). Validation:
  `pnpm run protocol:check`; regenerating twice produces no diff.
- [x] **A2. Generate the app's pregrad-manager ABI from protocol artifacts.**
  Replace the hand-written `app/src/integrations/contracts/pregrad-manager.ts`
  with output generated from the protocol pipeline (A1's mechanism). Keep the
  same exported name so app imports do not churn. Commit the generated file.
  Depends on: A1. Validation: `pnpm run app:check`; a diff between the old
  hand-written ABI and the generated one is reviewed function-by-function
  before merge (any semantic difference is a finding, not a silent fix).
- [x] **A3. Add an ABI freshness gate.** Add a check script (wired into
  `app:check` or root `check`) that regenerates the app-side ABI(s) and fails
  on diff, mirroring the existing `openapi:check` pattern. Depends on: A2.
- [x] **A4. Replace inline ABIs in protocol scripts with generated imports.**
  Remove the hand-declared ABI blocks in
  `protocol/scripts/create-complete-set-market.ts` (~80 lines),
  `protocol/scripts/operate-postgrad-admin.ts` (~130 lines), and
  `protocol/scripts/smoke-maker-order.ts`, importing from
  `protocol/src/generated/` instead. Depends on: A1. Validation:
  `pnpm run protocol:check` plus a local smoke run of at least one affected
  script against the devchain.
- [x] **A5. Ensure OpenAPI drift check runs in CI ahead of app codegen.**
  Verify/adjust CI so `server openapi:check` is a prerequisite of any job that
  runs the app's `api:generate` or build. If CI already guarantees this,
  document the guarantee in `server/README` (or nearest doc) and close the
  item with a note.

### Track B — Server cleanup

- [x] **B1. Extract shared AI-review response parsing.** Create
  `server/src/ai-review/response-parsing.ts` holding the verdict parsing,
  source-check parsing/filtering-by-evidence, score clamping/adjustment, and
  related helpers currently duplicated between
  `server/src/ai-review/anthropic.ts` and `server/src/ai-review/ollama.ts`.
  Both providers import it; duplicated copies are deleted. This is a security
  control — behavior must be preserved exactly; port existing tests and add
  coverage for the shared module. Validation: `pnpm run server:check`.
- [x] **B2. Split `server/src/ai-review/anthropic.ts` (604 lines) into focused
  modules** — HTTP call, tool/system-prompt building, evidence extraction, and
  a thin orchestrator — after B1 removes the parsing code. Depends on: B1.
- [x] **B3. Centralize viem client creation.** Export read-only and wallet
  client factories from `server/src/indexer/blockchain/client.ts` (or a new
  `server/src/blockchain/` module if indexer placement reads poorly) and
  migrate the ad-hoc clients in `server/src/api/services/markets.ts` and
  `server/src/api/services/dev-market-close.ts` (and
  `server/src/ai-review-runner/chain-review.ts` if applicable) onto them.
- [x] **B4. Extract SQL condition builders from
  `server/src/ai-review-runner/jobs.ts`** into a sibling `queries.ts`
  (claimable-job condition, no-active-job, no-existing-review predicates).
- [x] **B5. Extract failure handling from jobs.ts** into a sibling
  `failures.ts` (`markReviewJobFailure`, `cancelReviewJob`,
  `calculateRetryDelayMs`, `compactError`). Depends on: B4 (keeps the diff
  reviewable).
- [x] **B6. Add lint/format to the server workspace.** ESLint (flat config) +
  Prettier consistent with the shared config from D2, wired into
  `server:check`. Depends on: D2. Expect a mechanical formatting commit
  separate from any logic changes.

### Track C — Protocol contracts (human review required; NOT for autonomous merge)

- [x] **C1. Extract FeeManager from PregradManager.** Move creation-fee
  collection/withdrawal state and logic out of
  `protocol/contracts/PregradManager.sol`. Full test parity in
  `protocol/test/solidity/`.
- [x] **C2. Extract ReceiptBook from PregradManager.** Move receipt storage,
  validation, and LMSR quote entry points; PregradManager remains the
  lifecycle orchestrator. Depends on: C1.
- [x] **C3. Tighten the IPostgradAdapter handoff.** Have
  `prepareMarket` return (or PregradManager assert) outcome capacity so
  `finalizeGraduation` fails loudly on an underfunded adapter instead of
  trusting it.
- [x] **C4. Extract DeferredExecutionProcessor from BoundedPoolOrderManager.**
- [x] **C5. Extract SettlementManager from BoundedPoolOrderManager.**
  Depends on: C4.
- [x] **C6. Unify price/tick conversion.** Add a Solidity
  `PriceConversion` library (or extend `PoolTickBounds`) exposing
  display-price ↔ sqrtPriceX96 ↔ tick conversions, and re-anchor the
  TypeScript helpers in `protocol/scripts/shared/price/` (and their hardcoded
  policy bounds) against it so the two cannot silently diverge.

### Track D — Protocol tests and scripts (safe for autonomous execution)

- [x] **D1. Add `protocol/test/solidity/BaseTest.sol`** with shared fixtures
  (mock collateral setup, manager instantiation) and migrate the existing test
  contracts onto it.
- [x] **D1a. Stop re-declaring events in Solidity tests.** Import events from
  the contracts under test (e.g. the 10+ redeclarations in
  `protocol/test/solidity/PregradManager.t.sol`) so signature drift becomes a
  compile error. Depends on: D1 (land together or immediately after).
- [x] **D2. Bundle protocol script initialization.** Create
  `protocol/scripts/shared/cli/initializeScriptEnvironment.ts` wrapping the
  repeated connection/profile/wallet/chain-assert preamble, and migrate the
  top-level scripts onto it (mechanical, ~10 lines saved per script).
- [x] **D3. Split settlement indexer handlers only if they grow.** Explicitly
  deferred: `server/src/indexer/handlers/settlement.ts` (436 lines, 6 events)
  stays as-is until it gains more event types. This item exists so nobody
  "cleans it up" prematurely — close as won't-do unless the trigger fires.

### Track E — App cleanup

- [x] **E1. Split `app/src/integrations/wallet/wallet-provider.tsx` (539
  lines)** into `privy-wallet-provider.tsx`, `local-wallet-provider.tsx`, and
  `wallet-utilities.ts`, keeping `wallet-provider.tsx` as the context +
  orchestrator with an unchanged public API.
- [x] **E2. Consolidate token/WAD utilities.** One home (e.g.
  `app/src/domain/crypto/constants.ts` or `app/src/lib/`) for
  `TOKEN_DECIMALS`, `WAD`, `wadToNumber`/`numberToWad`, and a single
  `formatTokenAmount` in `app/src/lib/format.ts`; delete the copies in
  `create-market-service.ts`, `place-receipt-service.ts`,
  `create-market-panels.tsx`, and `api-market.ts`. Add unit tests.
- [x] **E3. Consolidate error-message extraction** into
  `app/src/lib/error-handling.ts` with an optional error-matcher hook;
  migrate the three variants (create-market-form, receipt-action,
  wallet-provider).
- [x] **E4. Wrap contract reads in integration-layer hooks.** Add
  `app/src/integrations/contracts/hooks/` (`useTrustedCreatorStatus`,
  `useMarketBalance`, `useMarketExists`) so
  `create-market-form.tsx` and `receipt-ticket.tsx` stop importing ABIs and
  calling `useReadContract` directly.
- [x] **E5. Extract the receipt-ticket state machine** into a
  `useReceiptTicketState` (and/or `useContractMarketStatus`) hook, leaving
  `receipt-ticket.tsx` as presentation. Depends on: E4.
- [x] **E6. Extract the create-market form state machine** into a
  `useCreateMarketFormState` hook (stage transitions, validation orchestration,
  retry/error flow). Depends on: E4.
- [ ] **E7. Split `create-market-panels.tsx` (498 lines)** into a
  `create-market-panels/` directory with one file per panel plus `shared.tsx`;
  panel-local formatters move to shared or `lib/format.ts` where duplicated.
- [x] **E8. Move app-ID parsing out of the domain layer.**
  `parseApiMarketAppId`/`apiMarketAppId` from
  `app/src/domain/markets/api-market.ts` to `app/src/lib/app-id.ts` (they are
  encoding-scheme adapters, not domain logic); update importers.

### Track F — Tooling and repo hygiene

- [x] **F1. Add a root `tsconfig.base.json`** carrying the shared strictness
  flags (`strict`, `skipLibCheck`, `esModuleInterop`,
  `forceConsistentCasingInFileNames`, `resolveJsonModule`); each workspace
  extends it and keeps only runtime-specific settings (target, module,
  moduleResolution, paths, jsx).
- [x] **F2. Share a root Prettier config**; app and protocol extend it instead
  of carrying separate copies. (Server picks it up via B6.)
- [x] **F3. Move verification screenshots out of `docs/` top level** into
  `docs/screenshots/` (~20 PNGs), updating any references in docs or PR
  templates/skills that link to them.
- [x] **F4. Write `docs/architecture.md`** documenting the workspace dependency
  graph and import rules (what may import from what, where generated code
  lives, the intentional MarketStatus/LMSR duplication), so the boundaries
  this program restores are enforceable by convention.

## Consequences

Positive:

- Contract interface drift between protocol and app becomes a build-time
  failure (Track A) instead of a runtime transaction failure.
- Security-relevant AI-review parsing has exactly one implementation (B1).
- The seven oversized files/contracts decompose into testable units without
  changing the system's shape.
- Small PRs keep every step reviewable and revertable; this file gives any
  session (human or autonomous) the full remaining work list.

Tradeoffs:

- ~30 PRs of review overhead and churn in file paths/imports; `git blame`
  history fragments across the moves.
- Generated ABI files add committed artifacts (mitigated by freshness gates).
- Track C is real contract surgery with audit implications; it is sequenced
  last and gated on human review by design.

## Execution Notes for Autonomous Sessions

- Safe to execute unattended: Tracks A, B, D (except D3 — leave closed), E, F.
  Do NOT merge Track C items unattended.
- Suggested order: A1 → A2 → A3 → A4, B1 → B2, then B3–B5, D1 → D1a, D2, E1–E8,
  F1–F4, A5. Items without a stated dependency are independent and may be done
  in any order.
- Workflow per item: fresh worktree/branch off `main` → implement → run the
  workspace gate(s) → open PR referencing this ADR item → merge-commit PR →
  delete the branch → pull the primary checkout (process-compose runs from
  it). Tick the checkbox and update the Progress Log in the same PR.
- If an item turns out to be wrong or already done, do not force it: close it
  in the Progress Log with a note and move on.
- If a gate fails for pre-existing reasons unrelated to the change, stop and
  record it in the Progress Log rather than working around it.

## Progress Log

| Date | Item | PR | Notes |
| ---- | ---- | -- | ----- |
| 2026-07-14 | D3 | TBD | The documented split trigger fired — `settlement.ts` gained a 7th event type (MarketCancelled, commit c2e9768) — so the deferred split was performed as specified: verbatim moves into `settlement-graduation.ts`, `settlement-refunds.ts` (cancel folded in, since MarketCancelled opens refunds), `settlement-claims.ts`, and private plumbing in `settlement-shared.ts`, with `settlement.ts` kept as a barrel because four modules import it. |
| 2026-07-13 | C6 | TBD | Human-reviewed; premise corrected during scoping: no production contract converts display prices (a scripts/app concept per ADR 0009), so the sketched on-chain PriceConversion library would have been dead code on the audited surface. The real divergence risk is the TS bit-exact TickMath ports (tickToSqrtPriceX96/sqrtPriceX96ToTick); C6 anchors them against canonical v4-core TickMath via a test-only harness + nodejs parity suite (boundary ticks, prime-stepped full-range grid, policy-band ticks both orientations/roundings, rounding-sensitive inverse spots). Test-only change; zero production-contract diff. Same dual-implementation-with-tests philosophy as the blessed LMSR duplication. This closes Track C and the program. |
| 2026-07-13 | — | — | Program complete: all 24 autonomous items (Tracks A/B/D/E/F, PRs #94–#125) plus all 6 Track C items under human review (C3 #126, C1 #128, C2 #132, C5 #184, C4 #190, C6 below). PregradManager 1,365→~1,090 lines; BoundedPoolOrderManager 1,273→~925; every contract extraction proven ABI-identical by zero-diff metadata regeneration. |
| 2026-07-13 | C4 | #190 | Human-reviewed; scope deliberately narrowed from the item's 'processor' framing: the resolver loop stays as manager orchestration (moving it would hand a library the manager's full state — same inversion rejected in C2), while deferred-execution STORAGE moved to a `DeferredExecutionStore` storage-struct library (struct, nonce-scoped IDs, store/at/isPending/remove, `DeferredExecutionStored` event, resolver target-tick clamp) and the pure partial-fill math moved to `PartialFillMath`. One stack-too-deep helper (`_executionId`) is commented per house rule. Manager is ~925 lines (from 1,273 pre-program). Zero-diff metadata regeneration; 205 tests, two-line test edit (event-selector requalification). |
| 2026-07-13 | C5 | #184 | Human-reviewed; executed BEFORE C4 (leaf-first is lower risk than the ADR's stated order). Balance-delta settlement plumbing moved to a stateless internal `V4DeltaSettlement` library (settleOrderInput, takePositiveDeltas/NetDeltas, settle, positive-delta readers, partial-add validation, four settlement errors, plus the ITokenPuller interface); the manager passes its immutables explicitly. Named V4DeltaSettlement rather than SettlementManager — it is delta mechanics, not a manager. Internal functions inline, the library declares no storage, and metadata regeneration is zero-diff (identical ABI, reachable library errors included); 205 tests, zero test edits. |
| 2026-07-07 | C2 | #132 | Human-reviewed: receipt-side mechanics moved to an abstract `ReceiptBook` base (ID allocation, receipt storage/lookups, existence/liveness guards, sequence math, receipt errors, `ReceiptPlaced` declaration); PregradManager keeps orchestration, settlement, market-state effects, and — deviating deliberately from the item text — the LMSR quote entry points, which read live market state and would otherwise hand the book access to market records. Zero-diff metadata regeneration (identical ABI, re-proven after rebasing over the ADR 0012 resolution-gate changes); full suite green post-rebase (205 tests), test edits are qualified-reference repoints only. |
| 2026-07-07 | C1 | #128 | Human-reviewed: fee custody mechanics moved to a new abstract `CreationFeeVault` base (collection accounting, withdrawal guards, fee errors/events); PregradManager keeps fee policy (`MARKET_CREATION_FEE`, trusted-creator waiver, `onlyOwner` gate) and inherits the vault, so the deployed contract, funds custody, and event emitter are unchanged — proven by a zero-diff metadata regeneration (identical ABI). 173 tests, exact parity; test edits are qualified-reference repoints only. Named CreationFeeVault rather than the ADR's FeeManager to say what it is (custody, not policy). |
| 2026-07-07 | C3 | #126 | Human-reviewed (Track C rule respected): `prepareMarket` now returns `(postgradMarket, outcomeCapacity)` and `finalizeGraduation` reverts with `PostgradCapacityMismatch` unless capacity equals the clearing root's `completeSetCount` — the check moved to the trust boundary instead of living only inside the concrete adapter. Strict equality is dust-safe: `_scaleAmount` is exact-or-revert (`AmountHasDust`), so capacity is a deterministic function of `retainedCostTotal`. New `MisreportingPostgradAdapter` mock proves the revert path. |
| 2026-07-07 | A2+A3 | — | Superseded by the workspace unification (follow-up to #120): the app now consumes `@popcharts/protocol` as a `workspace:*` dependency — `app/src/integrations/contracts/pregrad-manager.ts` is a one-line re-export of the package's generated module (Next transpiles the TS source via `transpilePackages`) — so the copy-and-check pipeline (`app/scripts/generate-contract-abis.mts`, its `abi:generate`/`abi:check` scripts, and the App CI step) is deleted. Freshness is structural now: there is no second copy to go stale. App CI path filters widen from the single generated file to `protocol/src/**`, mirrored in `app-ci-skip.yml`. |
| 2026-07-07 | D3 | — | Closed as deferred-by-design, per the item's own text: `settlement.ts` is still 6 events (~436 lines) and gained no new event types during this program, so the split trigger has not fired. The item stays unticked as the standing guard against premature cleanup. |
| 2026-07-07 | — | — | Program status: Tracks A, B, D, E, and F are complete (PRs #94–#118, plus #95 for a root-lockfile drift found en route). Track C (contract decomposition, C1–C6) remains open by design — it requires human review and must not be executed autonomously. |
| 2026-07-07 | A5 | #118 | The item's literal premise was vacuous — CI never runs the app's `api:generate`; the orval client is committed and `openapi:check` (required Server CI) already guards spec-vs-server drift. The real gap was committed-spec vs committed-client drift, closed in the A3 pattern: new `app api:check` regenerates the orval client into a scratch dir and fails on any difference, wired into `app:check` and App CI, with `server/generated/openapi.json` added to App CI's path filters (skip twin mirrored). The first run caught real drift: `models/index.ts` had hand-ordered re-exports; this PR commits the regenerated client. Gotcha encoded in the check script: the scratch dir must not be dot-prefixed or gitignored, or prettier silently skips it and the comparison false-fails. |
| 2026-07-07 | F4 | #117 | Wrote `docs/architecture.md` (~200 lines): workspace map, the artifact-mediated dependency graph (OpenAPI → orval client, protocol metadata → app ABI, server's inline viem ABI fragments), the acyclic import rules including the app-internal ones from `app/AGENTS.md`, the generated-artifact/freshness-gate table (noting the orval client has no dedicated diff gate — that's A5), the intentional MarketStatus and LMSR duplication with what actually keeps each aligned, and an "adding code: where does it go?" decision list; every claim was verified against current code — notably, protocol nodejs tests reuse `protocol/scripts/shared/` (protocol's own helpers, not root `scripts/shared/`), and feature *services* still import the generated ABI for transaction building (only components are barred from ABIs/`useReadContract`), so the doc states those precisely. |
| 2026-07-07 | F3 | #116 | Moved all 22 loose verification PNGs from the `docs/` top level into `docs/screenshots/` with `git mv`; a repo-wide sweep for each basename (plus generic `docs/.*\.png` and relative-link patterns) found exactly one reference — the `skills/engineering/ui-pr-verification/SKILL.md` instruction telling future PRs where to put screenshots — now updated to point at `docs/screenshots/`; `docs/deployment/` contains no PNGs, so no subdirectory files moved. |
| 2026-07-07 | B6 | #115 | Added Prettier (`prettier.config.mjs` spreading the root config with no workspace overrides, since the server code already follows prettier defaults — printWidth 80 produced 17 reformatted files vs 62 at width 88 and 77 at width 100) and ESLint (flat config, typescript-eslint recommended without type-checked rules, `^_` unused-var convention) to the server workspace, wired both into `server:check` and Server CI ahead of typecheck; the mechanical commit reformatted 17 of ~95 TS files and removed one dead type import. |
| 2026-07-07 | F2 | #114 | Shared the Prettier config: root `.prettierrc.json` holds the options app and protocol agree on (`singleQuote: false`, `semi: true`); each workspace's `.prettierrc` was replaced by a thin `prettier.config.mjs` that spreads the root and keeps only workspace-specific settings, since the two configs genuinely conflict (app: `printWidth: 88`, `trailingComma: "es5"`, tailwind plugin; protocol: `printWidth: 100`, `trailingComma: "all"`, `tabWidth`/`useTabs`, solidity plugin with its `*.sol` compiler override) — both `format:check` gates pass with zero reformats, and `.prettierignore` files stay workspace-local. |
| 2026-07-07 | F1 | #113 | Added root `tsconfig.base.json` carrying the five shared flags (`strict`, `skipLibCheck`, `esModuleInterop`, `forceConsistentCasingInFileNames`, `resolveJsonModule`) and made all five workspace tsconfigs (app, server, protocol, scripts, infra) extend it, dropping only the now-inherited flags — the two flags not previously in every config were already effective everywhere (`esModuleInterop` is implied by scripts' `module: NodeNext`; `forceConsistentCasingInFileNames` defaults to true since TS 5.0, covering app) and `resolveJsonModule` is purely additive for server/scripts/infra, so no workspace's effective options change (verified via `tsc --showConfig` before/after). |
| 2026-07-07 | E8 | #112 | Moved `apiMarketAppId`/`parseApiMarketAppId` (and their private `decodePathSegment` helper) verbatim from `app/src/domain/markets/api-market.ts` to a new `app/src/lib/app-id.ts` with unit tests (none existed before; coverage was only indirect via queries.test.ts), updating the two external importers (`domain/markets/queries.ts`, `features/receipt-ticket/place-receipt-service.ts`) and api-market.ts's own `apiMarketAppId` call; `apiMarketAppId`'s parameter is now typed structurally (`{ chainId: number; marketId: string }`, identical to the old `Pick<ApiMarket, ...>`) so lib does not import integrations types, and this introduces the app's first domain→lib import edge — allowed, since AGENTS.md only bars domain from React/Next/browser/wallet/UI imports and app-id is pure TS. |
| 2026-07-07 | E7 | #111 | Split `app/src/features/market-create/create-market-panels.tsx` verbatim into a `create-market-panels/` directory (`live-preview-panel.tsx`, `review-panel.tsx`, `submitted-panel.tsx`, `success-panel.tsx`, plus `shared.tsx` holding the two genuinely shared helpers: `ReviewRow` and the JSX-returning `formatDeadlineFromSeconds`), deleting the old file and updating its single importer (`create-market-form.tsx`); single-panel helpers stayed panel-local (`PreviewOutcome`/`CompactMetric` in live-preview, `formatWadPercent` in review, `formatSubmittedAt` in submitted), and no formatter moved to `lib/format.ts` because none duplicates it — `formatWadPercent` truncates to two decimals where `formatPercent` rounds to whole, and `formatSubmittedAt` renders local time where `formatDateTime` pins UTC. |
| 2026-07-07 | E6 | #110 | Extracted the create-market form's state machine verbatim into `app/src/features/market-create/use-create-market-form-state.ts` (`useCreateMarketFormState`: draft state and updates, edit/review/submitted/success stage transitions, validation orchestration with `hasTriedReview` and `focusFirstReviewError`, review-submission and creation flows with their E3 error-message wrappers, and the E4 `useTrustedCreatorStatus` consumption, returned as one state-plus-actions object), leaving `create-market-form.tsx` as destructuring plus JSX — no hook tests added, per the E5 precedent, since the hook is React wiring over already-tested pure functions (create-market, review-errors, wallet-create-action, create-market-service). |
| 2026-07-07 | E5 | #109 | Extracted the receipt ticket's state machine verbatim into `app/src/features/receipt-ticket/use-receipt-ticket-state.ts` (`useReceiptTicketState`: form state, placement/mint flows, refresh-key bumping, and derived quote/balance/action state, returned as one state-plus-actions object), leaving `receipt-ticket.tsx` as destructuring plus JSX — no hook tests added since the hook is React wiring over already-tested pure functions (receipt-action, receipt-quote, place-receipt-service). |
| 2026-07-06 | E4 | #108 | Added `app/src/integrations/contracts/hooks/` with `useTrustedCreatorStatus` (thin `useReadContract` wrapper for the devchain wallet-signed `isTrustedCreator` read, encapsulating ABI, contract config, and enabled conditions) and `useContractMarketStatus` (the receipt ticket's atomic `Promise.all` collateral-`balanceOf` + `marketExists` read with its request-key/refresh-key refetch semantics moved verbatim, taking the caller's error formatter), so `create-market-form.tsx` and `receipt-ticket.tsx` no longer import ABIs or call contract reads directly — the ADR's suggested `useMarketBalance`/`useMarketExists` pair became one hook because the component performs those reads as a single atomic request with shared loading/error state. |
| 2026-07-06 | E3 | #107 | Added `getErrorMessage(error, { fallback, matcher? })` in `app/src/lib/error-handling.ts` (with unit tests) and migrated the three variants onto it as thin wrappers kept at their existing exported locations (`getCreateMarketErrorMessage` + the twin `getReviewSubmissionErrorMessage` in create-market-form, `getReceiptPlacementErrorMessage` in receipt-action with its MarketDoesNotExist matcher, `getWalletErrorMessage` in wallet-utilities expressing its empty-message fallback via the matcher hook) — no importer changed, per-call-site empty-string semantics preserved. |
| 2026-07-06 | E2 | #106 | Added `app/src/domain/tokens/wad.ts` (`TOKEN_DECIMALS`, `WAD`, precise `wadToNumber`, with unit tests) and moved `formatTokenAmount` into `app/src/lib/format.ts` (with tests), deleting the three identical copies (create-market-service, place-receipt-service, and the devchain markets route) plus the duplicated `TOKEN_DECIMALS` consts (also receipt-ticket.tsx) and WAD literals (create-market-panels, api-market, market-creation); `api-market.ts` keeps its string-input `wadToNumber` as a thin adapter over the shared primitive, `numberToWad` was not added (market-creation's `amountToWad`/`percentageToWad` quantize to 6 decimals, a domain-specific rounding rule left alone), and test-file WAD fixture literals were left as-is. |
| 2026-07-06 | E1 | #105 | Split `app/src/integrations/wallet/wallet-provider.tsx` into `privy-wallet-provider.tsx` (Privy provider), `local-wallet-provider.tsx` (local wagmi fallback), and `wallet-utilities.ts` (shared helpers, pending-action/summary types, disabled-value constants), keeping `wallet-provider.tsx` as the context definition + orchestrator with its public exports (`WalletProviders`, `useWalletAccount`, `WalletAccountValue`, `WalletConnectionSummary`) unchanged — code moved verbatim, no importer changed. |
| 2026-07-06 | D2 | #104 | Added `protocol/scripts/shared/cli/initializeScriptEnvironment.ts` (read-only and with-wallet entry points, role-parameterized missing-account message, optional `loadConfig` hook that keeps per-script env-config errors in their original position) and migrated the 10 top-level scripts that repeated the connection/profile/wallet/chain-assert preamble (check-market-health, inspect-bounded-orders, keeper-complete-set, the four smoke scripts, create-complete-set-market, deploy-venue-stack, deploy-complete-set-postgrad); left alone deploy-arc-protocol (hardcoded ARC_TESTNET metadata instead of the chain profile), deploy-local-pregrad and create-local-market (minimal init without profile/chain-assert), and the scripts with no such preamble (check-venue-deployment, deploy-arc-mock, deploy-devchain, export-contract-metadata, operate-postgrad-admin, write-venue-manifest). |
| 2026-07-06 | D1+D1a | #103 | Added `protocol/test/solidity/BaseTest.sol` (mock-collateral fixture, WAD, PregradManager deploy helper, fund-and-approve helper) and migrated `PregradManager.t.sol` and `CompleteSetBinaryMarket.t.sol` onto it; the v4 venue suites (`BoundedPoolOrderManager`, `HookSkeletonAndPriceBounds`, `LocalV4StackSmoke`) stay standalone because v4-core pins them to solc 0.8.26 and they share no fixtures with the 0.8.28 BaseTest, and the library-harness suites (`ClearingMath`, `LmsrMath`, `ReceiptBands`, `V4DependencyHarness`) have one-line unique setups; deleted the 14 re-declared events in `PregradManager.t.sol` in favor of qualified `emit PregradManager.X(...)` references and replaced the hand-hashed `DeferredExecutionStored` topic constant with the event's `.selector` — test count unchanged at 104 solidity + 67 nodejs. |
| 2026-07-06 | B5 | #102 | Moved the failure-path helpers (`markReviewJobFailure`, `cancelReviewJob`, `calculateRetryDelayMs`, `compactError`, and the retry-cap/error-length constants) verbatim from `server/src/ai-review-runner/jobs.ts` into a sibling `failures.ts`; jobs.ts imports the two job-state writers and jobs.test.ts imports the two pure helpers from the new module — no behavior change. |
| 2026-07-06 | B4 | #101 | Moved the three pure query-predicate builders (`claimableReviewJobCondition`, `noActiveReviewJobForCurrentMarket`, `noAiReviewForCurrentMarket`) verbatim from `server/src/ai-review-runner/jobs.ts` into a sibling `queries.ts`; jobs.ts imports them and drops its now-unused `isNull`/`lte`/`or` db-client imports — no behavior change. |
| 2026-07-06 | B3 | #100 | Chose the new-module placement: the indexer factory moved verbatim to `server/src/blockchain/client.ts` (shared home, since importing from `indexer/` into `api/` crosses subsystem boundaries), which now also exports `createReadOnlyClient()` and `createWalletClient(account)` HTTP factories; migrated the ad-hoc clients in `api/services/markets.ts`, `api/services/dev-market-close.ts`, and `ai-review-runner/chain-review.ts` onto them with no config or behavior changes. |
| 2026-07-06 | B2 | #99 | Split `server/src/ai-review/anthropic.ts` into `anthropic/http.ts` (Messages API call + response/content-block types), `anthropic/tools.ts` (web tool + system prompt building), and `anthropic/evidence.ts` (evidence extraction/dedupe + URL helpers), leaving `anthropic.ts` as a thin orchestrator exporting `reviewWithAnthropic`/`AnthropicReview` at its unchanged import path; code moved verbatim. |
| 2026-07-06 | B1 | #98 | `server/src/ai-review/response-parsing.ts` now holds the single implementation of verdict parsing, source-check parsing/filtering, score clamping, and the shared `RawModelReview` type; anthropic and ollama providers import it (~150 duplicated lines deleted, byte-identical logic — only the JSON-failure message is parameterized by provider name). Ollama keeps its heuristic-only helpers. 16 new unit tests cover the shared module directly. |
| 2026-07-06 | A4 | #97 | Scope corrected during execution: the pool-manager/state-view ABIs in `create-complete-set-market.ts` and the transfer-approval ABI in `smoke-maker-order.ts` are vendored external v4 contracts (not in our pipeline) and stay inline, as does the dev-only mintable-collateral ABI. The real Pop Charts inline ABIs lived in `operate-postgrad-admin.ts`, `check-market-health.ts`, `inspect-bounded-orders.ts`, and four `scripts/shared/market/` helpers — all now import from `protocol/src/generated/`. Event-scanning call sites derive their event subset via `getAbiItem` because `getContractEvents` decodes every event in the ABI it receives. Also added an env-overridable localhost network URL (`POPCHARTS_LOCAL_RPC_URL`) to `hardhat.config.ts` so smoke validation can run on an isolated chain. Validated on an isolated devchain: deploy → create market → maker order → `check-market-health` and `inspect-bounded-orders` both correct. |
| 2026-07-06 | A1 | — | Closed as already done: `export-contract-metadata.ts` already generates all four v4 ABIs (plus CompleteSetBinaryMarket, CompleteSetPostgradAdapter, OutcomeToken) into `protocol/src/generated/postgrad-venue.ts`, deterministically, re-exported from `protocol/src/index.ts`. The ADR item was written against a stale premise. |
| 2026-07-06 | A3 | #96 | `abi:check` wired into root `app:check` and as an App CI step. App CI path filters now also trigger on `protocol/src/generated/pregrad-manager.ts` (the generation source), with the complement mirrored in `app-ci-skip.yml`, so a protocol metadata regeneration cannot merge with a stale app ABI. |
| 2026-07-06 | A2 | #94 | `app/scripts/generate-contract-abis.mts` renders the app's `pregradManagerAbi` from `protocol/src/generated/pregrad-manager.ts` (mirrors the orval/openapi.json pattern). Hand-written 28-entry subset replaced by the full 118-entry generated ABI; structural comparison of all 28 overlapping entries found zero semantic differences (`internalType` annotations and `as const satisfies Abi` are the only additions). `--check` flag included, wired into the gate in A3. |
