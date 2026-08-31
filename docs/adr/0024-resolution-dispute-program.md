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

Phase 1 — protocol (human-reviewed, keystone) — **landed 2026-07-24**
(PRs #328 propose/finalize, #321 dispute/bond/settlement):

- [x] `CompleteSetBinaryMarket`: `ResolutionPending`/`Disputed` statuses,
      `proposeResolution`/`dispute`/`finalizeResolution`, settlement
      semantics for `resolve`/`cancel`, bond custody separated from
      redemption solvency, new events incl. bond paper-trail trio.
- [x] `CompleteSetPostgradAdapter`/`prepareMarket`: plumb `disputeWindow` +
      `disputeBond` per market (24h on deployed networks, seconds locally).
      Local deploy seams pin both to zero through
      `scripts/shared/deployment/localDisputeConfig.ts`, which keeps the
      legacy direct-`resolve()` path working until Phase 3 lands.
- [x] Solidity + nodejs tests: full status-machine matrix, bond
      refund/forfeit paths, self-dispute exemption, solvency invariants
      with a posted bond, zero-window degeneration.
- [x] Regenerate ABIs/metadata; update every hand-encoded event fixture;
      keep `contract-abi-parity.test.ts` pins honest.

Phase 2 — indexer:

- [x] Raw tables + watchers for `ResolutionProposed`, `ResolutionDisputed`,
      `DisputeBondPosted/Refunded/Forfeited` (receipt-linked, immutable —
      AGENTS.md money invariant); `MarketResolved` watcher unchanged.
      *(`db/schema/postgrad-dispute-events.ts` and
      `postgrad-dispute-bond-events.ts`; all five events subscribed in
      `indexer/watchers/postgrad-market.ts` and handled by
      `handlers/postgrad-dispute.ts` and `postgrad-dispute-bond.ts`.)*
- [x] `markets.status` projection gains `resolution_pending` and
      `disputed`; guarded transitions from `graduated`; wire into the
      ADR 0021 change-feed so the UI sees dispute state live. *(Statuses
      declared in `db/schema/markets.ts`; `handlers/market-projection.ts`
      guards the transitions and raises `market_status_out_of_order` on an
      illegal one; `handlers/postgrad-dispute.ts` calls `recordLiveChange`
      from the ADR 0021 change-feed writer.)*

Phase 3 — runner + keeper:

- [x] Runner submits `proposeResolution` (rename chain action; drop the
      superseded off-chain delay); requeue/gate logic unchanged.
      *(`ai-resolution-runner/chain-resolution.ts`; ADR 0026 made the intent
      durable and #546 added the pre-signing re-check.)*
- [x] Keeper: finalize-after-window duty (discover pending markets past
      deadline, submit `finalizeResolution`, idempotent on races with
      public finalizers). *(`keeper/resolution-finalize.ts` and
      `keeper/discovery.ts`; the public failsafe sibling is
      `POST /markets/:chainId/:marketId/resolution-finalize`.)*
- [x] Lifecycle harness (ADR 0017 C3): scenario covering propose → dispute
      → operator settle, and propose → window → auto-finalize.
      *(`lifecycle-nightly/scenarios/dispute-settlement.ts` and
      `dispute-window-finalize.ts`, using `setPostgradDisputeConfig` and
      `settleDisputedPostgradMarketAsResolver` from
      `lifecycle-nightly/operator.ts`.)*

Phase 4 — API + app:

- [x] **Landed 2026-07-24 (PR #342).** Public resolution-request endpoint
      (`POST /markets/:chainId/:marketId/resolution-check`): anyone may
      ask the resolver to look at a graduated market that is past its
      earliest-resolution gate — the sibling of the public graduation
      trigger. The poke only enqueues a resolution job; the resolver
      still decides, and the dispute window still guards the outcome, so
      the endpoint is defended with rate limits, not cryptoeconomics: a
      per-market cooldown (one requested evaluation per 24h regardless of
      requester count) bounds worst-case AI spend at daily-poll cost while
      only paying for markets someone actually cares about. A premature
      request lands `too_early` and hands off to the existing bounded
      backoff requeue. Deferred deliberately (decision 2026-07-24, after
      weighing signature quorums, bounties, and blanket polling):
      position-weighted triage (requests from indexed position holders
      bypass the cooldown or jump the queue) only if spam materializes,
      and a cheap pre-screen model gating the full evidence pipeline only
      if AI spend bites. Signature-quorum and bounty designs rejected for
      v1 — a request is not a money-moving action, and quorums starve the
      long tail of small markets.
- [ ] Market reads expose pending/disputed state, `proposedSide`,
      countdown, bond size. *(Partial: `resolution_pending` and `disputed`
      reach the app through `MarketStatusSchema`, and resolved markets carry
      `MarketResolutionSchema`. `proposedSide`, the dispute countdown and the
      bond size are not in the API models yet.)*
- [x] Dispute button (wallet-signed, injected-client contract service
      pattern) with bond approve+post flow; pending/disputed surfaces on
      the market page (extends ADR 0018's terminal-surface work — that
      ADR's executor should treat `resolution_pending`/`disputed` as two
      more non-Trading states to design for).
      *(`app/src/features/market-detail/market-dispute-panel.tsx`.)*
- [ ] Operator: self-dispute + settle actions in the local admin tooling
      (never the deployed API — operator model). *(Partial: resolver-keyed
      settle and cancel helpers exist in
      `server/src/lifecycle-nightly/operator.ts` and force-resolve is a
      dev-menu action; neither self-dispute nor settle is reachable from the
      local admin tooling yet.)*

Phase 5 — ops:

- [ ] Alarm on `ResolutionDisputed` (a dispute is an operator page, not a
      background event). *(Partial: the signal is emitted —
      `shared/operator-alert-log.ts` defines `resolution_disputed` and
      `handlers/postgrad-dispute.ts` raises it. The alarm that watches for it
      is CloudWatch work and belongs to ADR 0015, so this box closes when the
      stack is deployed.)*
- [x] Update ADR 0012's delay-window checkbox to point here. *(ADR 0012's
      dispute-story box is ticked and points at this ADR.)*

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
