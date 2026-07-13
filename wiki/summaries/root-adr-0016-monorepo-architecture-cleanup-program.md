---
type: summary
title: Repo ADR 0016 — Monorepo architecture cleanup program
description: Tracked cleanup program of ~30 one-concern PRs across six tracks; Tracks A/B/D/E/F executed 2026-07-06..07, Track C (contract decomposition) open pending human review.
sources:
  - docs/adr/0016-monorepo-architecture-cleanup-program.md
updated: 2026-07-09
---

# Repo ADR 0016: Monorepo Architecture Cleanup Program

**Status: Accepted — Tracks A/B/D/E/F executed 2026-07-06..07; Track C open
(human review required).** Dated 2026-07-06.

> **Renumbered:** originally filed as a second "0007" (colliding with
> `docs/adr/0007-track-verticals-with-progress-adrs.md`), this cleanup program
> was renumbered to **0016** on 2026-07-09 and added to the `docs/adr/README.md`
> index. It sits outside the M1–M5 launch milestone chain.

## Context

A 2026-07-06 architectural review found the macro-architecture healthy
(acyclic workspace dependency graph, explicit boundaries, generated code
quarantined behind adapters, OpenAPI as the app's single typed source of truth
for the server API). Debt was file-level, in four patterns: god
files/contracts (seven files >500 lines, worst `PregradManager.sol` at 1,365
and `BoundedPoolOrderManager.sol` at 1,273); same-layer duplication (token
formatting, error extraction, AI-review response parsing duplicated between
providers — a duplicated security control — inline ABIs, script boilerplate);
boundary leaks (components importing ABIs directly, ad-hoc viem clients, and a
~347-line hand-written app ABI with no pipeline to the contract, so drift
surfaced as runtime failures); and tooling inconsistency (five divergent
tsconfigs, partial linting, loose screenshots in `docs/`).

Duplication that is intentional and preserved: the `MarketStatus` definitions
in Solidity / server TypeBox / app domain types, and the LMSR math in
`protocol/contracts/libraries/LmsrMath.sol` (canonical) plus
`app/src/domain/lmsr/lmsr.ts` (UI replica, independently tested).

## Decision

Run a tracked cleanup program of small, independent, behavior-preserving PRs —
one checklist item per PR, checkbox ticked in the same PR, progress logged in
the ADR itself. Track C (Solidity decomposition of fund-holding contracts)
requires human review and must never be merged by an unattended session.

## Work-item status (checkboxes as recorded)

### Track A — Contract ABI pipeline and drift protection: complete

- [x] A1 Export v4 contract ABIs from the protocol metadata pipeline —
  closed as **already done** (stale premise; `export-contract-metadata.ts`
  already generated them).
- [x] A2 Generate the app's pregrad-manager ABI from protocol artifacts —
  landed as PR #94, then **superseded** by workspace unification: the app now
  consumes `@popcharts/protocol` as a `workspace:*` dependency and the app-side
  copy is a one-line re-export, so the copy-and-check pipeline was deleted.
- [x] A3 ABI freshness gate (PR #96) — likewise made structural by the
  unification (no second copy to go stale).
- [x] A4 Replace inline ABIs in protocol scripts with generated imports
  (PR #97) — scope corrected: vendored external v4 ABIs and a dev-only
  mintable-collateral ABI stay inline; the real Pop Charts inline ABIs (in
  operate-postgrad-admin, check-market-health, inspect-bounded-orders, and
  four shared market helpers) now import from `protocol/src/generated/`.
- [x] A5 OpenAPI drift check ahead of app codegen (PR #118) — literal premise
  was vacuous (CI never runs the app's `api:generate`); the real gap was
  committed-spec vs committed-client drift, closed with a new `app api:check`
  that regenerates the orval client and fails on diff.

### Track B — Server cleanup: complete

- [x] B1 Extract shared AI-review response parsing into
  `server/src/ai-review/response-parsing.ts` (PR #98) — single implementation
  of verdict parsing, source-check filtering, score clamping (~150 duplicated
  lines deleted; security control now has exactly one copy; 16 new unit
  tests).
- [x] B2 Split `anthropic.ts` (604 lines) into http/tools/evidence modules
  plus a thin orchestrator (PR #99).
- [x] B3 Centralize viem client creation in `server/src/blockchain/client.ts`
  (PR #100); migrated markets, dev-market-close, and chain-review services.
- [x] B4 Extract SQL condition builders from ai-review-runner `jobs.ts` into
  `queries.ts` (PR #101).
- [x] B5 Extract failure handling into `failures.ts` (PR #102).
- [x] B6 Add ESLint + Prettier to the server workspace, wired into
  `server:check` and Server CI (PR #115).

### Track C — Protocol contracts (human review required): OPEN

- [x] C1 Extract FeeManager from PregradManager — human-reviewed; landed as an
  abstract **`CreationFeeVault`** base (custody: collection accounting,
  withdrawal guards, fee errors/events) while PregradManager keeps fee policy
  (`MARKET_CREATION_FEE`, trusted-creator waiver, `onlyOwner` gate). Zero-diff
  ABI regeneration; 173 tests exact parity. Renamed from the ADR's
  "FeeManager" to say what it is (custody, not policy).
- [ ] C2 Extract ReceiptBook from PregradManager (receipt storage, validation,
  LMSR quote entry points). Depends on C1.
- [x] C3 Tighten the IPostgradAdapter handoff (PR #126) — `prepareMarket` now
  returns `(postgradMarket, outcomeCapacity)` and `finalizeGraduation` reverts
  with `PostgradCapacityMismatch` unless capacity equals the clearing root's
  `completeSetCount`; strict equality is dust-safe because `_scaleAmount` is
  exact-or-revert.
- [ ] C4 Extract DeferredExecutionProcessor from BoundedPoolOrderManager.
- [ ] C5 Extract SettlementManager from BoundedPoolOrderManager. Depends on C4.
- [ ] C6 Unify price/tick conversion (Solidity `PriceConversion` library;
  re-anchor the TypeScript helpers in `protocol/scripts/shared/price/`).

### Track D — Protocol tests and scripts: complete (D3 deferred by design)

- [x] D1 + D1a Shared `BaseTest.sol` fixtures; stop re-declaring events in
  Solidity tests (PR #103) — 14 re-declared events deleted in favor of
  qualified `emit PregradManager.X(...)`; test count unchanged (104 solidity +
  67 nodejs).
- [x] D2 `initializeScriptEnvironment.ts` shared script preamble; 10 top-level
  scripts migrated (PR #104).
- [ ] D3 Split settlement indexer handlers only if they grow — **closed as
  deferred-by-design** per its own text (trigger never fired; stays unticked
  as a standing guard against premature cleanup).

### Track E — App cleanup: complete per Progress Log

- [x] E1 Split `wallet-provider.tsx` (539 lines) into privy/local providers +
  utilities (PR #105).
- [x] E2 Consolidate token/WAD utilities (`app/src/domain/tokens/wad.ts`,
  `formatTokenAmount` in `lib/format.ts`) (PR #106).
- [x] E3 Consolidate error-message extraction into
  `app/src/lib/error-handling.ts` (PR #107).
- [x] E4 Wrap contract reads in integration-layer hooks
  (`useTrustedCreatorStatus`, `useContractMarketStatus`) (PR #108).
- [x] E5 Extract `useReceiptTicketState` hook (PR #109).
- [x] E6 Extract `useCreateMarketFormState` hook (PR #110).
- [ ] E7 Split `create-market-panels.tsx` — **checkbox unticked, but the
  Progress Log records it landed as PR #111** (split into a
  `create-market-panels/` directory). Stale checkbox; treat as done.
- [x] E8 Move app-ID parsing to `app/src/lib/app-id.ts` (PR #112).

### Track F — Tooling and repo hygiene: complete

- [x] F1 Root `tsconfig.base.json` with five shared strictness flags, all five
  workspaces extend it (PR #113).
- [x] F2 Shared root Prettier config; app/protocol keep only genuine
  workspace-specific overrides (PR #114).
- [x] F3 Move 22 verification PNGs into `docs/screenshots/` (PR #116).
- [x] F4 Write `docs/architecture.md` — workspace map, artifact-mediated
  dependency graph, import rules, generated-artifact/freshness-gate table,
  intentional duplication notes (PR #117).

## Program status (from the Progress Log, 2026-07-07)

Tracks A, B, D, E, F complete (PRs #94–#118, plus #95 for a root-lockfile
drift found en route). Track C (C2, C4–C6) remains open by design — human
review required, not for autonomous execution.

## Related pages

- [../concepts/monorepo-architecture.md](../concepts/monorepo-architecture.md)
- [../concepts/creation-fee-custody.md](../concepts/creation-fee-custody.md)
- [../entities/pregrad-manager.md](../entities/pregrad-manager.md)
- [../entities/creation-fee-vault.md](../entities/creation-fee-vault.md)
- [../entities/protocol-workspace.md](../entities/protocol-workspace.md)
- [../entities/server-workspace.md](../entities/server-workspace.md)
- [../entities/app-workspace.md](../entities/app-workspace.md)
- [../entities/ai-review-service.md](../entities/ai-review-service.md)
