---
type: entity
title: Clearing keeper
description: The offchain service that computes band-pass clearing deterministically and submits the Merkle clearing root — built; ADR 0008's whole clearing block closed 2026-07-13, but it is poll-based and still gated to the local network.
sources:
  - docs/clearing-keeper-design.md
  - docs/adr/0008-protocol-functionality-completion.md
  - protocol/docs/adr/0006-use-optimistic-offchain-graduation-clearing.md
  - docs/adr/0014-full-lifecycle-e2e-testing.md
  - docs/adr/0015-deployment-and-infrastructure.md
updated: 2026-07-14
---

# Clearing keeper

**Status: built.** ADR 0008's entire clearing block was ticked on 2026-07-13 —
the runnable keeper, the whitepaper golden tests, and the full outcome space
(full match / partial match with refunds / no-match). It lives in **`server/`**
(`server/src/keeper/`); the real band-pass sweep replaced the greedy dev
placeholder in `dev-graduation-clearing.ts` (which filled receipts in placement
order and ignored the path intervals). The Merkle/leaf plumbing
(`hashReceiptClaim`, `buildClaimMerkleTree`, `RECEIPT_CLAIM_TYPEHASH`) already
matched the contract byte-for-byte and was reused unchanged — only the fill
logic had been wrong. The optimistic clearing design
([protocol ADR 0006](../summaries/protocol-adr-0006-optimistic-offchain-graduation-clearing.md))
is what assumes this offchain, deterministic computation.

**Two things the ticked checkboxes do not mean** — both stated in ADR 0008
itself, and both load-bearing for anyone trusting this component:

1. **It is poll-based, not event-driven.** The graduation pass drives
   eligibility, clearing, and the no-match refund off the market projection plus
   a `ReceiptPlaced`-triggered check. There is **no `GraduationStarted`
   watcher**, despite the original item text (and despite what the older wiki
   text below promised).
2. **The automated keeper — auto-refund included — is gated to the local network
   with dev tools enabled.** Everywhere else, no-match refunds still rely on the
   permissionless on-chain `markRefundable` plus the `MarketRefundsAvailable`
   indexer watcher. The mechanism is done; unattended production operation is
   not.

Design specifics: a pure `computeBandPassClearing` (golden-tested against
whitepaper Example A); frozen-book reconstruction verified against the emitted
`snapshotHash` before it is trusted; largest-remainder (Hamilton) integer
rounding that holds the §6 conservation identities exactly and **fails closed**
before submit; and three-outcome decision logic (graduate / `markRefundable` at
deadline / wait) computed **offchain before touching the chain** so a
`Graduating` market is never stranded below threshold.

Built:

- Compute deterministic band-pass clearing → submit `ClearingRootSubmitted`
  (matchedMarketCap, refundTotal, retainedCostTotal, completeSetCount, Merkle
  root)
  ([root ADR 0008](../summaries/root-adr-0008-protocol-functionality-completion.md)).
- **Golden tests** in `server/src/keeper/clearing/band-pass-clearing.test.ts`:
  whitepaper **Example A** pinned line by line (band eligibility, scarce-side
  full retention, 50/50 proration of the crowded side in the contested band,
  exact escrow conservation), plus conservation/balance invariants over 2,000
  random books, order-independence, and the lopsided-book case the sweep fixes
  that a naive `min(totalYes, totalNo)` would wrongly graduate. *Example B is
  not separately pinned* — worth adding if the clearing math is touched again.
- The full outcome space, including automatic `markRefundable` at the graduation
  deadline for no-match markets (local network only — see the caveat above).
- Whitepaper open question 3 (integer rounding for deterministic clearing) is
  answered here: largest-remainder (Hamilton) rounding that holds the §6
  conservation identities exactly and **fails closed** before submit.

Still open:

- The e2e harness must boot it ([root ADR 0014](../summaries/root-adr-0014-full-lifecycle-e2e-testing.md));
  it deploys as its own ECS service ([root ADR 0015](../summaries/root-adr-0015-deployment-and-infrastructure.md));
  the app's graduation outcome view depends on it emitting real results
  ([root ADR 0013](../summaries/root-adr-0013-app-feature-completion.md)).
- Ungating the automated keeper beyond the local network.
- Trust model on testnet: keeper is trusted, tamper-evident via the challenge
  window; bonded challenges/fraud proofs deferred to mainnet.

## Related pages

- [Clearing keeper design](../summaries/clearing-keeper-design.md) — the detailed sweep + rounding + decision-logic design
- [Graduation clearing](../concepts/graduation-clearing.md) — the math it runs
- [PregradManager](pregrad-manager.md) — the contract it drives
