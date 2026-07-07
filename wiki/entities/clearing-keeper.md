---
type: entity
title: Clearing keeper (planned)
description: The planned offchain service that watches GraduationStarted, computes band-pass clearing deterministically, and submits the Merkle clearing root — not yet built.
sources:
  - docs/adr/0008-protocol-functionality-completion.md
  - protocol/docs/adr/0006-use-optimistic-offchain-graduation-clearing.md
  - docs/adr/0014-full-lifecycle-e2e-testing.md
  - docs/adr/0015-deployment-and-infrastructure.md
updated: 2026-07-07
---

# Clearing keeper (planned)

**Status: not yet built.** Band-pass clearing math currently lives only in
protocol scripts; no service runs it automatically. The optimistic clearing
design ([protocol ADR 0006](../summaries/protocol-adr-0006-optimistic-offchain-graduation-clearing.md))
assumes an offchain service that computes clearing deterministically from the
onchain receipt book and produces the root + claim leaves. No source names its
host workspace yet — presumably `server/`.

Planned shape, per the vertical ADRs:

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

- [Graduation clearing](../concepts/graduation-clearing.md) — the math it runs
- [PregradManager](pregrad-manager.md) — the contract it drives
