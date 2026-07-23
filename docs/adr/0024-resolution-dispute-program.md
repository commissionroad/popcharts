# ADR 0024: Resolution Dispute Program

Status: Accepted

Date: 2026-07-20

## Context

The AI resolver will sometimes be wrong. ADR 0019's measured evals put
numbers on this — wrong-direction verdicts from criteria-literalism are a
demonstrated failure mode, and the only planned mitigation was an off-chain
24-hour operator delay (ADR 0012), which protects exactly as far as the
operator's attention reaches. Market participants — the people holding the
losing side of a wrong resolution — currently have no recourse at all: on
Pop Charts, `resolve()` is terminal the moment it lands.

Protocol ADR 0013 (Proposed alongside this ADR) specifies the on-chain
mechanism: resolution becomes propose → 24h public dispute window →
permissionless finalize, with a bonded `dispute()` that freezes the market
for human adjudication, free resolver self-dispute as the operator-override
path, and full paper-trail events for every bond movement. This ADR is the
cross-stack program that lands it.

## Decision

Build the dispute window as a tracked, one-concern-per-PR program across
protocol, server, and app, in the phase order below. The protocol slice is
the keystone and requires human review (funds-holding contract, ADR 0016
rule). The off-chain operator delay from ADR 0012 is superseded: the runner
submits `proposeResolution` immediately once a verdict clears its gates,
and the on-chain window *is* the delay.

## Progress

Phase 0 — decisions (user):

- [x] Settled 2026-07-23 (recorded in protocol ADR 0013 §Phase 0
      decisions): flat ~100-unit bond configured at graduation, forfeits
      to the protocol owner, no disputer bounty in v1, operator settlement
      is final in v1.

Phase 1 — protocol (human-reviewed, keystone):

- [ ] `CompleteSetBinaryMarket`: `ResolutionPending`/`Disputed` statuses,
      `proposeResolution`/`dispute`/`finalizeResolution`, settlement
      semantics for `resolve`/`cancel`, bond custody separated from
      redemption solvency, new events incl. bond paper-trail trio.
- [ ] `CompleteSetPostgradAdapter`/`prepareMarket`: plumb `disputeWindow` +
      `disputeBond` per market (24h on deployed networks, seconds locally).
- [ ] Solidity + nodejs tests: full status-machine matrix, bond
      refund/forfeit paths, self-dispute exemption, solvency invariants
      with a posted bond, zero-window degeneration.
- [ ] Regenerate ABIs/metadata; update every hand-encoded event fixture;
      keep `contract-abi-parity.test.ts` pins honest.

Phase 2 — indexer:

- [ ] Raw tables + watchers for `ResolutionProposed`, `ResolutionDisputed`,
      `DisputeBondPosted/Refunded/Forfeited` (receipt-linked, immutable —
      AGENTS.md money invariant); `MarketResolved` watcher unchanged.
- [ ] `markets.status` projection gains `resolution_pending` and
      `disputed`; guarded transitions from `graduated`; wire into the
      ADR 0021 change-feed so the UI sees dispute state live.

Phase 3 — runner + keeper:

- [ ] Runner submits `proposeResolution` (rename chain action; drop the
      superseded off-chain delay); requeue/gate logic unchanged.
- [ ] Keeper: finalize-after-window duty (discover pending markets past
      deadline, submit `finalizeResolution`, idempotent on races with
      public finalizers).
- [ ] Lifecycle harness (ADR 0017 C3): scenario covering propose → dispute
      → operator settle, and propose → window → auto-finalize.

Phase 4 — API + app:

- [ ] Market reads expose pending/disputed state, `proposedSide`,
      countdown, bond size.
- [ ] Dispute button (wallet-signed, injected-client contract service
      pattern) with bond approve+post flow; pending/disputed surfaces on
      the market page (extends ADR 0018's terminal-surface work — that
      ADR's executor should treat `resolution_pending`/`disputed` as two
      more non-Trading states to design for).
- [ ] Operator: self-dispute + settle actions in the local admin tooling
      (never the deployed API — operator model).

Phase 5 — ops:

- [ ] Alarm on `ResolutionDisputed` (a dispute is an operator page, not a
      background event).
- [ ] Update ADR 0012's delay-window checkbox to point here; wiki ingest.

## Consequences

- Every resolution waits 24h before redemption opens — the UX cost of
  making wrong resolutions recoverable. ADR 0018's surfaces must make the
  pending state legible or it will read as "stuck".
- One more keeper duty and two more indexer watchers; both are
  `marketId`-keyed and transfer unchanged to the protocol ADR 0012
  singleton book.
- The dispute bond introduces a second user-side value transfer in the
  postgrad lifecycle; the paper-trail invariant extends to it from day one.

## Related ADRs

- Protocol ADR 0013 (mechanism) · ADR 0012 (AI resolution, supersedes its
  delay window) · ADR 0019 (why: measured fallibility) · ADR 0018 (UI
  surfaces) · ADR 0021 (live dispute-state delivery) · ADR 0017 C3
  (lifecycle scenarios) · protocol ADR 0012 (singleton-book compatibility).
