# ADR 0010: Disable The Clearing Challenge Window By Default

## Status

Accepted

Amends ADR 0006.

## Context

ADR 0006 introduced optimistic offchain graduation clearing with a hardcoded
one-day challenge window (`CLEARING_CHALLENGE_PERIOD = 1 days`) between
`submitClearingRoot` and `finalizeGraduation`. The window is the security
budget for the optimistic assumption: an honest watcher can recompute the
deterministic band-pass clearing and dispute a bad root before retained
collateral moves into the postgrad market.

In the current deployment that assumption buys nothing:

- Clearing roots are submitted by the graduation manager (the contract owner),
  the same party the window would be protecting against. There is no
  third-party proposer role yet.
- The contract has no challenge entry point, bonds, or fraud proofs; the
  window is a pure timeout with no dispute mechanism behind it.
- Graduation is a product moment. A one-day dead period between "market hit
  its threshold" and "postgrad market is live" makes graduation feel broken,
  and it forces local development tooling to time-travel the chain.

## Decision

Replace the hardcoded constant with an owner-configurable
`clearingChallengePeriod` that defaults to zero, so clearing roots finalize
immediately after submission.

- `setClearingChallengePeriod(uint64)` is owner-only, capped by
  `MAX_CLEARING_CHALLENGE_PERIOD = 7 days`, and emits
  `ClearingChallengePeriodUpdated`.
- `submitClearingRoot` stamps each root's `challengeDeadline` from the period
  configured at submission time, so an in-flight root keeps the window it was
  submitted under.
- Everything else from ADR 0006 stands: clearing stays offchain, roots stay
  Merkle-committed and conservation-checked, claims stay proof-verified.

When third parties can propose clearing roots and an optimistic dispute
mechanism exists to check their work, the window should be turned on with a
short period — on the order of five minutes, not days — because graduation
must stay a fast process. Anything longer belongs to a future fraud-proof or
zero-knowledge design that removes the trust assumption instead of stretching
the timeout.

## Consequences

Graduation finalizes in the same block as root submission by default, matching
the v1 trust model where the manager both computes and submits clearing.

The optimistic-security posture of ADR 0006 is explicitly deferred rather than
weakened: with a manager-submitted root, a nonzero timeout never protected
users; it only delayed settlement. The configuration knob preserves the
commitment format and the `challengeDeadline` plumbing (events, indexer
schema, API) so enabling a real dispute window later is a parameter change,
not a redeploy.

The owner can change the window at any time, which is acceptable while the
owner already controls clearing itself. Revisit the setter's authority when
root submission opens up to third parties.
