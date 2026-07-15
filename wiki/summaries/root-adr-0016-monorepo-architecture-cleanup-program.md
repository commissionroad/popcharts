---
type: summary
title: Repo ADR 0016 — Monorepo architecture cleanup program
description: Tracked cleanup program of ~30 one-concern PRs across six tracks; fully executed — Tracks A/B/D/E/F 2026-07-06..07 autonomously, Track C (contract decomposition) 2026-07-07..13 under per-item human review; the one deferred item (D3 settlement-handler split) fired its trigger and was executed 2026-07-14.
sources:
  - docs/adr/0016-monorepo-architecture-cleanup-program.md
updated: 2026-07-15
---

# Repo ADR 0016: Monorepo Architecture Cleanup Program

**Status: Accepted — fully executed.** Tracks A/B/D/E/F ran autonomously
2026-07-06..07; Track C (the fund-holding contract decomposition) ran
2026-07-07..13 with per-item human review and closed the program on 2026-07-13.
Dated 2026-07-06.

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

### Track C — Protocol contracts (human review required): complete 2026-07-13

Every item was reviewed per-item by a human and proven behavior-preserving by a
**zero-diff metadata regeneration** (identical ABI). Two items deliberately
deviated from the ADR's own item text — recorded here because the names and
scopes in the ADR body no longer describe what shipped.

- [x] C1 Extract FeeManager from PregradManager (PR #128) — human-reviewed;
  landed as an abstract **`CreationFeeVault`** base (custody: collection
  accounting, withdrawal guards, fee errors/events) while PregradManager keeps
  fee policy (`MARKET_CREATION_FEE`, trusted-creator waiver, `onlyOwner` gate).
  173 tests exact parity. Renamed from the ADR's "FeeManager" to say what it is
  (custody, not policy).
- [x] C2 Extract ReceiptBook from PregradManager (PR #132) — abstract
  **`ReceiptBook`** base takes ID allocation, receipt storage/lookups,
  existence/liveness guards, sequence math, receipt errors, and the
  `ReceiptPlaced` declaration. **Deviation:** the LMSR quote entry points stayed
  in PregradManager despite the item text — they read live market state, and
  moving them would hand the book access to market records. 205 tests.
- [x] C3 Tighten the IPostgradAdapter handoff (PR #126) — `prepareMarket` now
  returns `(postgradMarket, outcomeCapacity)` and `finalizeGraduation` reverts
  with `PostgradCapacityMismatch` unless capacity equals the clearing root's
  `completeSetCount`; strict equality is dust-safe because `_scaleAmount` is
  exact-or-revert.
- [x] C4 Extract DeferredExecutionProcessor from BoundedPoolOrderManager
  (PR #190) — **scope narrowed:** the resolver loop stays as manager
  orchestration (moving it would hand a library the manager's full state — the
  same inversion rejected in C2). What moved: deferred-execution *storage* into
  a `DeferredExecutionStore` storage-struct library (nonce-scoped IDs,
  store/at/isPending/remove, `DeferredExecutionStored`, resolver target-tick
  clamp) and the pure partial-fill math into `PartialFillMath`.
- [x] C5 Extract SettlementManager from BoundedPoolOrderManager (PR #184) —
  executed **before** C4 (leaf-first is lower risk than the ADR's stated order).
  Landed as a stateless internal **`V4DeltaSettlement`** library (delta
  settlement plumbing, positive-delta readers, partial-add validation, four
  settlement errors, the `ITokenPuller` interface); the manager passes its
  immutables explicitly. Named for the mechanics, not "manager".
- [x] C6 Unify price/tick conversion — **premise corrected during scoping:** no
  production contract converts display prices (that is a scripts/app concept per
  protocol ADR 0009), so the sketched on-chain `PriceConversion` library would
  have been dead code on the audited surface. The real divergence risk is the
  bit-exact **TypeScript TickMath ports**, which C6 anchors against canonical
  v4-core TickMath through a test-only harness plus a nodejs parity suite
  (boundary ticks, prime-stepped full-range grid, policy-band ticks in both
  orientations/roundings). Test-only; zero production-contract diff — the same
  dual-implementation-with-tests philosophy as the blessed LMSR duplication.

### Track D — Protocol tests and scripts: complete

- [x] D1 + D1a Shared `BaseTest.sol` fixtures; stop re-declaring events in
  Solidity tests (PR #103) — 14 re-declared events deleted in favor of
  qualified `emit PregradManager.X(...)`; test count unchanged (104 solidity +
  67 nodejs).
- [x] D2 `initializeScriptEnvironment.ts` shared script preamble; 10 top-level
  scripts migrated (PR #104).
- [x] D3 Split settlement indexer handlers only if they grow — held as
  deferred-by-design through program close (2026-07-13), then the documented
  trigger fired: `server/src/indexer/handlers/settlement.ts` gained a 7th
  event type (MarketCancelled, commit c2e9768, per protocol ADR 0011). Split
  executed 2026-07-14 as specified: verbatim moves into
  `settlement-graduation.ts`, `settlement-refunds.ts` (cancel folded in —
  MarketCancelled opens refunds), and `settlement-claims.ts`, with private
  plumbing in `settlement-shared.ts` and `settlement.ts` kept as a barrel
  (four modules import that surface).

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
- [x] E7 Split `create-market-panels.tsx` into a `create-market-panels/`
  directory (PR #111). The checkbox long read `[ ]` — the tick was lost in the
  0007→0016 renumber merge — and was **re-ticked in the 2026-07-14 bookkeeping
  pass**.
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

## Program status (from the Progress Log, closed 2026-07-13)

**Complete.** All 24 autonomous items (Tracks A/B/D/E/F, PRs #94–#125, plus #95
for a root-lockfile drift found en route) and all 6 Track C items under human
review (C3 #126, C1 #128, C2 #132, C5 #184, C4 #190, C6). The god-file numbers
that motivated the program: `PregradManager.sol` 1,365 → ~1,090 lines,
`BoundedPoolOrderManager.sol` 1,273 → ~925.

**Every box in the raw ADR now reads `[x]`.** The two that used to lag are both
resolved:

- **E7** landed as PR #111 but its checkbox was lost in the 0007→0016 renumber
  merge; it was re-ticked in the 2026-07-14 bookkeeping pass (see Track E above).
- **D3** — long the other unticked box, held as deferred-by-design — was ticked
  on 2026-07-14 after its documented trigger fired (see Track D above).

That same 2026-07-14 pass also recorded C6's PR (#191) and reconciled
`docs/architecture.md` with post-program reality — the real server→protocol
edge (`file:../protocol`), the resolution/keeper subsystems, and the app
import-rule refinements.

## Related pages

- [../concepts/monorepo-architecture.md](../concepts/monorepo-architecture.md)
- [../concepts/creation-fee-custody.md](../concepts/creation-fee-custody.md)
- [../entities/pregrad-manager.md](../entities/pregrad-manager.md)
- [../entities/creation-fee-vault.md](../entities/creation-fee-vault.md)
- [../entities/protocol-workspace.md](../entities/protocol-workspace.md)
- [../entities/server-workspace.md](../entities/server-workspace.md)
- [../entities/app-workspace.md](../entities/app-workspace.md)
- [../entities/ai-review-service.md](../entities/ai-review-service.md)
