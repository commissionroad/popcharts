# ADR 0008: Protocol Functionality Completion

Status: Accepted

Date: 2026-07-06

## Context

The pregrad mechanism from whitepaper v4 is implemented and tested:
`PregradManager` handles market creation with an `UnderReview` gate, virtual
LMSR receipt quoting, collateral escrow, and optimistic Merkle-based
graduation clearing (protocol ADR 0006). The postgrad slice exists as ERC20
complete sets (`CompleteSetBinaryMarket`, protocol ADR 0008), a
`CompleteSetPostgradAdapter`, and a Uniswap v4 venue
(`BoundedPoolOrderManager`, `BoundedPredictionHook`) that is smoke-tested
locally.

Known gaps: the band-pass clearing computation lives only in operational
scripts rather than a service the stack can run continuously; the
`bypassAiResolution` flag has no finalized semantics; resolution is a bare
resolver role with no entry points designed for a resolution service; and the
postgrad handoff has not been exercised under every clearing outcome.

## Decision

Finish the protocol's code functionality for the Arc Testnet launch, keeping
the optimistic-clearing trust model as is. Deployment is ADR 0015. A security
audit, bonded challenges/fraud proofs, and the mainnet CTF-compatibility
decision (protocol ADR 0007) remain deferred.

## Progress

Clearing:

- [x] Extract the band-pass clearing computation from protocol scripts into a
      runnable keeper/service that computes the clearing root deterministically
      and submits `ClearingRootSubmitted` (`@popcharts/protocol`
      `computeBandPassClearing`, driven by the keeper's graduation pass).
- [x] Golden tests pinning keeper output to worked examples from whitepaper
      v4.
- [x] Keeper handles the full outcome space: full match, partial match with
      refunds, and no-match/full-refund markets (the last opens full escrow
      refunds via `markRefundable` automatically at the graduation deadline).

  Note: the graduation service is poll-based — the keeper's graduation pass
  drives eligibility, clearing, and the no-match refund off the market
  projection and a `ReceiptPlaced`-triggered check, not a dedicated
  `GraduationStarted` event-watcher. The automated keeper (including the
  auto-refund) is currently gated to the local network with dev tools enabled;
  no-match refunds otherwise rely on the permissionless on-chain `markRefundable`
  plus the `MarketRefundsAvailable` indexer watcher.

Resolution hooks:

- [ ] Finalize `bypassAiResolution` semantics and enforce them in
      `PregradManager` and the review/resolution services.
- [ ] Define and test the resolver entry points a resolution service will
      call on `CompleteSetBinaryMarket` (`resolve`, `cancel` for draws),
      including access control and post-`resolutionTime` gating.

Postgrad handoff:

- [x] Integration tests proving `GraduationFinalized` funding and per-receipt
      claims through `CompleteSetPostgradAdapter` under each clearing
      outcome.
- [x] Verify the v4 venue path (pool creation, bounded ticks, maker/taker
      flow) against a graduated market end to end on the devchain.
- [ ] Resolve the open question of Uniswap v4 availability on Arc Testnet
      (deploy our own PoolManager vs. depend on a canonical one) and record
      the answer as a protocol ADR.

Unhappy paths:

- [x] Contract tests for rejected markets, refund-only graduations, claims
      after `MarketRefundsAvailable`, challenge-window expiry, and
      fee-on-transfer collateral (`MockFeeCollateral`).
- [x] Confirm receipt escrow accounting is exact (no dust, no stranded
      collateral) across every terminal market status.

## Exit Criteria

A market can move through every status in
`UnderReview → Active → Graduating → Graduated → Resolved` (and each
rejection/refund branch) on the local devchain with no manual script
invocations, driven only by the deployed contracts plus the clearing keeper
and review/resolution runners.

## Consequences

- The offchain clearing service remains trusted (tamper-evident via the
  challenge window, but unproven). Acceptable for Arc Testnet; revisit before
  mainnet alongside the audit.
- Resolution entry points designed here constrain the resolution service
  (ADR 0012); the two should land in coordinated slices.
