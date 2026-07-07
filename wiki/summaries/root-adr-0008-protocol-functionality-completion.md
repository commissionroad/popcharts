---
type: summary
title: Repo ADR 0008 — Protocol functionality completion
description: Vertical ADR to finish protocol code (clearing keeper, resolution hooks, postgrad handoff, unhappy paths) before any deployment; all nine checklist items open as of 2026-07-07.
sources:
  - docs/adr/0008-protocol-functionality-completion.md
updated: 2026-07-07
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

## Progress (all items unchecked as of 2026-07-07)

Clearing:

- [ ] Extract band-pass clearing from protocol scripts into a runnable
  keeper/service: watch `GraduationStarted`, compute the clearing root
  deterministically, submit `ClearingRootSubmitted`.
- [ ] Golden tests pinning keeper output to worked examples from whitepaper v4.
- [ ] Keeper handles the full outcome space: full match, partial match with
  refunds, no-match/full-refund.

Resolution hooks:

- [ ] Finalize `bypassAiResolution` semantics; enforce in `PregradManager` and
  the review/resolution services.
- [ ] Define and test resolver entry points on `CompleteSetBinaryMarket`
  (`resolve`, `cancel` for draws), including access control and
  post-`resolutionTime` gating.

Postgrad handoff:

- [ ] Integration tests proving `GraduationFinalized` funding and per-receipt
  claims through `CompleteSetPostgradAdapter` under each clearing outcome.
- [ ] Verify the v4 venue path (pool creation, bounded ticks, maker/taker
  flow) against a graduated market end to end on the devchain.
- [ ] Resolve Uniswap v4 availability on Arc Testnet (deploy our own
  PoolManager vs. canonical) and record the answer as a protocol ADR.

Unhappy paths:

- [ ] Contract tests for rejected markets, refund-only graduations, claims
  after `MarketRefundsAvailable`, challenge-window expiry, fee-on-transfer
  collateral (`MockFeeCollateral`).
- [ ] Confirm receipt escrow accounting is exact (no dust, no stranded
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
