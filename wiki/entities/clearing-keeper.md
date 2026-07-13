---
type: entity
title: Clearing keeper (planned)
description: The offchain service that watches GraduationStarted, computes band-pass clearing deterministically, and submits the Merkle clearing root — design accepted, the real sweep is replacing the greedy dev placeholder.
sources:
  - docs/clearing-keeper-design.md
  - docs/adr/0008-protocol-functionality-completion.md
  - protocol/docs/adr/0006-use-optimistic-offchain-graduation-clearing.md
  - docs/adr/0014-full-lifecycle-e2e-testing.md
  - docs/adr/0015-deployment-and-infrastructure.md
updated: 2026-07-13
---

# Clearing keeper (planned)

**Status: design accepted; real sweep replacing the dev placeholder.** The
detailed [clearing keeper design](../summaries/clearing-keeper-design.md)
(2026-07-09) resolves the shape and the integer-rounding policy, and the real
band-pass sweep has begun landing (PRs #172/#176). It lives in **`server/`**:
`server/src/api/services/dev-graduation-clearing.ts` was an explicit **greedy
placeholder** (fills receipts in placement order, ignores the path intervals),
gated to local dev in `server/src/keeper/`; the design replaces that plan
computation with the real band-pass sweep and ungates it. The Merkle/leaf
plumbing (`hashReceiptClaim`, `buildClaimMerkleTree`, `RECEIPT_CLAIM_TYPEHASH`)
already matches the contract byte-for-byte and is reused unchanged — only the
fill logic was wrong. The optimistic clearing design
([protocol ADR 0006](../summaries/protocol-adr-0006-optimistic-offchain-graduation-clearing.md))
is what assumes this offchain, deterministic computation.

Design specifics: a pure `computeBandPassClearing` (golden-tested against
whitepaper Example A); frozen-book reconstruction verified against the emitted
`snapshotHash` before it is trusted; largest-remainder (Hamilton) integer
rounding that holds the §6 conservation identities exactly and **fails closed**
before submit; and three-outcome decision logic (graduate / `markRefundable` at
deadline / wait) computed **offchain before touching the chain** so a
`Graduating` market is never stranded below threshold.

Planned/remaining shape, per the vertical ADRs and design:

- Watch `GraduationStarted` → compute deterministic band-pass clearing →
  submit `ClearingRootSubmitted` (matchedMarketCap, refundTotal,
  retainedCostTotal, completeSetCount, Merkle root)
  ([root ADR 0008](../summaries/root-adr-0008-protocol-functionality-completion.md)).
- Golden tests pinned to whitepaper v4 worked Examples A and B; must cover
  full match, partial + refunds, and no-match outcomes.
- The e2e harness must boot it ([root ADR 0014](../summaries/root-adr-0014-full-lifecycle-e2e-testing.md));
  it deploys as its own ECS service ([root ADR 0015](../summaries/root-adr-0015-deployment-and-infrastructure.md));
  the app's graduation outcome view is blocked on it emitting real results
  ([root ADR 0013](../summaries/root-adr-0013-app-feature-completion.md)).
- Trust model on testnet: keeper is trusted, tamper-evident via the challenge
  window; bonded challenges/fraud proofs deferred to mainnet.
- Whitepaper open question 3 (rounding policy for deterministic clearing
  under integer arithmetic) lands on this component's design.

## Related pages

- [Clearing keeper design](../summaries/clearing-keeper-design.md) — the detailed sweep + rounding + decision-logic design
- [Graduation clearing](../concepts/graduation-clearing.md) — the math it runs
- [PregradManager](pregrad-manager.md) — the contract it drives
