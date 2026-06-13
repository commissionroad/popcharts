# ADR 0006: Use Optimistic Offchain Graduation Clearing

## Status

Accepted

## Context

Whitepaper v4 defines deterministic band-pass graduation clearing over a frozen
receipt book. The clearing algorithm collects receipt path endpoints, sorts
them, sweeps adjacent bands, computes overlap, prorates crowded sides, and
splits each receipt into retained cost and refund.

Running the full sweep directly onchain creates liveness and gas risks:

- endpoint sorting is expensive
- sweep complexity grows with receipts and bands
- dust receipts can grief graduation by creating many endpoints
- popular markets may become uneconomical or impossible to clear in one
  transaction
- chunked onchain clearing introduces partial-progress, rounding, and stuck
  locked-state edge cases
- late reverts waste large amounts of gas and can make graduation fragile

The protocol still needs onchain custody, deterministic settlement, and user
verification. The expensive computation does not need to happen entirely
onchain in v1.

## Decision

Use optimistic offchain graduation clearing for v1.

The target flow is:

```txt
1. startGraduation(marketId)
   - manager-only in v1
   - locks receiptCount and final LMSR state
   - enters `Graduating`

2. offchain API service computes band-pass clearing
   - deterministic from onchain receipt book/events

3. submitClearingRoot(...)
   - matchedMarketCap
   - refundTotal
   - retainedCostTotal
   - completeSetCount
   - Merkle root of per-receipt outcomes

4. challenge window
   - bonded submitter
   - invalid roots can be challenged before finalization

5. finalizeGraduation(...)
   - marks the clearing root final
   - prepares/splits collateral into postgrad complete sets

6. users claim by Merkle proof
   - retained YES/NO outcome tokens
   - refund amount
```

The clearing root must commit to enough data to verify each receipt's outcome:
retained shares, retained cost, refund, side, owner, and receipt identity.

`graduationDeadline` is a deadline, not the earliest graduation time. A market
can enter `Graduating` before the deadline if the manager starts offchain
clearing. If the deadline passes while the market is still active, the market
becomes refundable instead of entering graduation.

## Consequences

Graduation liveness no longer depends on fitting the full band sweep into one
transaction. Users can claim independently, so one large market does not require
one giant settlement transaction.

The protocol introduces an optimistic assumption: at least one honest watcher
or participant must be able to challenge an invalid root during the challenge
window. The challenge design needs its own focused implementation plan and
tests.

The onchain contract must make invalid or stale roots hard to submit:

- roots are tied to `marketId`, locked receipt count, and locked LMSR state
- root totals must match escrow-level conservation checks
- finalization must wait through the challenge window
- claims must be one-time and proof-checked

Future versions may strengthen this with fraud proofs, interactive challenges,
or zero-knowledge proofs. Those are not required for v1, but the commitment
format should not block them.
