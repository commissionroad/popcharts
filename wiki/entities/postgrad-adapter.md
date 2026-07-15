---
type: entity
title: CompleteSetPostgradAdapter
description: The graduation handoff boundary — receives retained collateral from PregradManager, deploys postgrad markets, and distributes retained YES/NO through claims.
sources:
  - protocol/docs/adr/0006-use-optimistic-offchain-graduation-clearing.md
  - protocol/docs/adr/0007-handoff-to-ctf-style-postgrad-market.md
  - protocol/docs/adr/0009-complete-set-testnet-policy.md
  - protocol/docs/postgrad-contract-metadata.md
  - docs/adr/0016-monorepo-architecture-cleanup-program.md
updated: 2026-07-15
---

# CompleteSetPostgradAdapter

Implements `IPostgradAdapter` — the trust boundary between the
[PregradManager](pregrad-manager.md) and the postgrad venue. The manager
verifies Merkle proofs and retained/refund accounting; the adapter receives
only approved claim data and exactly the approved retained collateral.

## Responsibilities

- `prepareMarket` deploys the [CompleteSetBinaryMarket](postgrad-market.md)
  and returns `(postgradMarket, outcomeCapacity)`; `finalizeGraduation`
  reverts with `PostgradCapacityMismatch` if capacity mismatches the clearing
  root's `completeSetCount` (cleanup program C3, landed).
- Pins `outcomeDecimals = 18` for every market it deploys; wires
  `retainedMinter = adapter`, `owner = adapter owner`, `resolver = adapter
  resolver` ([protocol ADR 0009](../summaries/protocol-adr-0009-complete-set-testnet-policy.md)).
- Distributes retained YES/NO balances through PregradManager-verified claims;
  emits `PostgradMarketPrepared` — the event-first discovery root for the
  [indexer](indexer.md).
- Never asked to rescue undercollateralized markets; refunded markets bypass
  it entirely.

## Related pages

- [Graduation clearing](../concepts/graduation-clearing.md) — produces the totals it enforces
- [Postgrad v4 venue](postgrad-v4-venue.md) — the trading layer above it
