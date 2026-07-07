---
type: summary
title: "ADR 0006: Use Optimistic Offchain Graduation Clearing"
description: Accepted — band-pass clearing is computed offchain and committed onchain as a Merkle root with a challenge window; bonded challenges and fraud proofs are deferred past v1
sources:
  - protocol/docs/adr/0006-use-optimistic-offchain-graduation-clearing.md
updated: 2026-07-07
---

# ADR 0006: Use Optimistic Offchain Graduation Clearing

**Status: Accepted.**

## Decision

Use optimistic offchain graduation clearing for v1: the deterministic
band-pass sweep runs offchain, its result is committed onchain as a Merkle
root, and finalization is gated by a challenge window. See
[graduation clearing](../concepts/graduation-clearing.md).

Target flow:

1. `startGraduation(marketId)` — manager-only in v1; locks `receiptCount`
   and final LMSR state; market enters `Graduating`.
2. An offchain API service computes band-pass clearing, deterministically
   from the onchain receipt book/events.
3. `submitClearingRoot(...)` — carries `matchedMarketCap`, `refundTotal`,
   `retainedCostTotal`, `completeSetCount`, and a Merkle root of per-receipt
   outcomes.
4. Challenge window — timeout-gated finalization in the current contract;
   bonded challenges / fraud proofs are deferred.
5. `finalizeGraduation(...)` — marks the root final and funds a postgrad
   adapter with retained collateral
   ([postgrad market](../entities/postgrad-market.md)).
6. Users claim by Merkle proof — retained YES/NO balances through the
   adapter, refunds from manager-held collateral.

The clearing root must commit to enough data to verify each receipt's
outcome: retained shares, retained cost, refund, side, owner, and receipt
identity.

`graduationDeadline` is a **deadline, not the earliest graduation time**: a
market can enter `Graduating` before the deadline; if the deadline passes
while still active, the market becomes refundable instead (see
[market lifecycle](../concepts/market-lifecycle.md)).

## Context

Whitepaper v4's clearing algorithm (collect and sort receipt path endpoints,
sweep adjacent bands, compute overlap, prorate crowded sides, split each
receipt into retained cost and refund) is gas- and liveness-hostile onchain:
sorting is expensive, complexity grows with receipts and bands, dust receipts
can grief graduation, popular markets may be impossible to clear in one
transaction, chunked clearing creates partial-progress edge cases, and late
reverts waste gas. Onchain custody, deterministic settlement, and user
verification are still required — only the expensive computation moves off.

## Consequences

- Graduation liveness no longer depends on one giant settlement transaction;
  users claim independently.
- Introduces an optimistic assumption: at least one honest watcher must be
  able to challenge an invalid root during the window. The current
  implementation enforces only a challenge **timeout**; active challenge
  submission, bonds, and fraud-proof logic need their own focused plan and
  tests (echoed by the [protocol README](protocol-readme.md)).
- Invalid/stale roots must be hard to submit: roots tie to `marketId`,
  locked receipt count, and locked LMSR state; totals must satisfy
  escrow-level conservation checks; finalization waits out the window;
  claims are one-time and proof-checked.
- Future hardening (fraud proofs, interactive challenges, ZK proofs) is not
  required for v1, but the commitment format must not block it.

## Related pages

- [Pregrad manager](../entities/pregrad-manager.md)
- [Complete sets](../concepts/complete-sets.md)
- [Summary: ADR 0007 — CTF-style postgrad handoff](protocol-adr-0007-ctf-style-postgrad-handoff.md)
