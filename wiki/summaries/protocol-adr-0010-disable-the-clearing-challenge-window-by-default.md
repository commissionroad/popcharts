---
type: summary
title: "ADR 0010: Disable The Clearing Challenge Window By Default"
description: Accepted — the clearing challenge window becomes owner-configurable `clearingChallengePeriod`, default 0, capped at 7 days; re-enable (~5 minutes) only when third-party proposers and a dispute mechanism exist
sources:
  - protocol/docs/adr/0010-disable-the-clearing-challenge-window-by-default.md
updated: 2026-07-07
---

# ADR 0010: Disable The Clearing Challenge Window By Default

**Status: Accepted. Amends
[ADR 0006](protocol-adr-0006-optimistic-offchain-graduation-clearing.md).**

## Decision

Replace the hardcoded `CLEARING_CHALLENGE_PERIOD = 1 days` with an
owner-configurable `clearingChallengePeriod` that **defaults to zero**, so
clearing roots finalize immediately after submission.

- `setClearingChallengePeriod(uint64)` is owner-only, capped by
  `MAX_CLEARING_CHALLENGE_PERIOD = 7 days`, and emits
  `ClearingChallengePeriodUpdated`.
- `submitClearingRoot` stamps each root's `challengeDeadline` from the period
  configured at submission time, so an in-flight root keeps the window it was
  submitted under.
- Everything else from ADR 0006 stands: clearing stays offchain, roots stay
  Merkle-committed and conservation-checked, claims stay proof-verified.

When third parties can propose clearing roots and an optimistic dispute
mechanism exists, the window should be re-enabled with a **short** period —
on the order of five minutes, not days — because graduation must stay a fast
process. Anything longer belongs to a future fraud-proof or zero-knowledge
design.

## Context

The window is the security budget for ADR 0006's optimistic assumption, but
in the current deployment it buys nothing: clearing roots are submitted by
the graduation manager (the contract owner) — the party the window would
protect against; the contract has no challenge entry point, bonds, or fraud
proofs (the window is a pure timeout); and a one-day dead period between
"market hit its threshold" and "postgrad market live" makes graduation feel
broken while forcing local dev tooling to time-travel the chain.

## Consequences

- Graduation finalizes in the same block as root submission by default,
  matching the v1 trust model where the manager both computes and submits
  clearing.
- The optimistic-security posture is explicitly **deferred, not weakened**:
  with a manager-submitted root, a nonzero timeout never protected users. The
  knob preserves the commitment format and `challengeDeadline` plumbing
  (events, indexer schema, API), so enabling a real dispute window later is a
  parameter change, not a redeploy.
- The owner can change the window at any time — acceptable while the owner
  already controls clearing; revisit the setter's authority when root
  submission opens to third parties.

## Related pages

- [Summary: ADR 0006 — optimistic offchain graduation clearing](protocol-adr-0006-optimistic-offchain-graduation-clearing.md)
- [Graduation clearing](../concepts/graduation-clearing.md)
- [Pregrad manager](../entities/pregrad-manager.md)
