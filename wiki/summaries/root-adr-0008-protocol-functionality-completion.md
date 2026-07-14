---
type: summary
title: Repo ADR 0008 — Protocol functionality completion
description: Vertical ADR to finish protocol code (clearing keeper, resolution hooks, postgrad handoff, unhappy paths) before any deployment; 7 of 10 done as of 2026-07-13 — the whole clearing block is now closed (keeper, golden tests, full outcome space incl. auto-refund), resolution hooks and Arc v4 availability still open.
sources:
  - docs/adr/0008-protocol-functionality-completion.md
updated: 2026-07-14
---

# Repo ADR 0008: Protocol Functionality Completion

**Status: Accepted.** Dated 2026-07-06. Progress checklist per the ADR 0007
process ([summary](root-adr-0007-track-verticals-with-progress-adrs.md)).

## Context

Implemented and tested: the whitepaper v4 pregrad mechanism —
`PregradManager` market creation with an `UnderReview` gate, virtual LMSR
receipt quoting, collateral escrow, and optimistic Merkle-based graduation
clearing (protocol ADR 0006). The postgrad slice exists as ERC20 complete sets
(`CompleteSetBinaryMarket`, protocol ADR 0008), a `CompleteSetPostgradAdapter`,
and a Uniswap v4 venue (`BoundedPoolOrderManager`, `BoundedPredictionHook`)
smoke-tested locally.

Known gaps: band-pass clearing lives only in operational scripts, not a
continuously runnable service; `bypassAiResolution` has no finalized
semantics; resolution is a bare resolver role with no service-facing entry
points; the postgrad handoff hasn't been exercised under every clearing
outcome.

## Decision

Finish protocol code functionality for the Arc Testnet launch, keeping the
optimistic-clearing trust model as is. Deployment is ADR 0015. Deferred: a
security audit, bonded challenges/fraud proofs, and the mainnet
CTF-compatibility decision (protocol ADR 0007).

## Progress (7 of 10 done as of 2026-07-13)

Clearing — **the whole block closed 2026-07-13**:

- [x] Extract band-pass clearing from protocol scripts into a runnable
  keeper/service that computes the clearing root deterministically and submits
  `ClearingRootSubmitted` — `computeBandPassClearing` in `@popcharts/protocol`,
  driven by the keeper's graduation pass.
- [x] Golden tests pinning keeper output to worked examples from whitepaper v4 —
  landed in `server/src/keeper/clearing/band-pass-clearing.test.ts` (whitepaper
  **Example A** pinned line by line, plus conservation/balance invariants over
  2,000 random books and an order-independence check).
- [x] Keeper handles the full outcome space: full match, partial match with
  refunds, and no-match/full-refund — the last now opens full escrow refunds via
  `markRefundable` **automatically at the graduation deadline**.

Two caveats the ADR states explicitly and the wiki should not round off:

1. **The graduation service is poll-based, not event-driven.** The keeper's
   graduation pass drives eligibility, clearing, and the no-match refund off the
   market projection plus a `ReceiptPlaced`-triggered check — there is no
   dedicated `GraduationStarted` watcher, despite the original item text.
2. **The automated keeper (auto-refund included) is currently gated to the local
   network with dev tools enabled.** In every other environment, no-match refunds
   still depend on the permissionless on-chain `markRefundable` plus the
   `MarketRefundsAvailable` indexer watcher. The item is ticked for the
   mechanism, not for unattended production operation.

Resolution hooks:

- [ ] Finalize `bypassAiResolution` semantics; enforce in `PregradManager` and
  the review/resolution services.
- [ ] Define and test resolver entry points on `CompleteSetBinaryMarket`
  (`resolve`, `cancel` for draws), including access control and
  post-`resolutionTime` gating.

Postgrad handoff:

- [x] Integration tests proving `GraduationFinalized` funding and per-receipt
  claims through `CompleteSetPostgradAdapter` under each clearing outcome.
- [x] Verify the v4 venue path (pool creation, bounded ticks, maker/taker
  flow) against a graduated market end to end on the devchain.
- [ ] Resolve Uniswap v4 availability on Arc Testnet (deploy our own
  PoolManager vs. canonical) and record the answer as a protocol ADR.

Unhappy paths:

- [x] Contract tests for rejected markets, refund-only graduations, claims
  after `MarketRefundsAvailable`, challenge-window expiry, fee-on-transfer
  collateral (`MockFeeCollateral`).
- [x] Confirm receipt escrow accounting is exact (no dust, no stranded
  collateral) across every terminal market status.

## Exit criteria

A market moves through every status in
`UnderReview → Active → Graduating → Graduated → Resolved` (and each
rejection/refund branch) on the local devchain with no manual script
invocations — driven only by the deployed contracts plus the clearing keeper
and review/resolution runners.

## Consequences

The offchain clearing service remains trusted (tamper-evident via the
challenge window, but unproven) — acceptable for Arc Testnet, revisit before
mainnet alongside the audit. Resolver entry points designed here constrain the
resolution service (ADR 0012); land the two in coordinated slices.

## Related pages

- [../entities/pregrad-manager.md](../entities/pregrad-manager.md)
- [../entities/postgrad-market.md](../entities/postgrad-market.md)
- [../entities/protocol-workspace.md](../entities/protocol-workspace.md)
- [../entities/devchain.md](../entities/devchain.md)
- [../concepts/graduation-clearing.md](../concepts/graduation-clearing.md)
- [../concepts/complete-sets.md](../concepts/complete-sets.md)
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md)
- [../concepts/ai-assisted-resolution.md](../concepts/ai-assisted-resolution.md)
- [../concepts/mechanism-whitepaper.md](../concepts/mechanism-whitepaper.md)
