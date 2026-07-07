---
type: entity
title: CreationFeeVault
description: Abstract base contract holding creation-fee custody mechanics, extracted from PregradManager (cleanup program C1); policy stays in the manager.
sources:
  - docs/adr/0007-monorepo-architecture-cleanup-program.md
  - protocol/docs/adr/0009-complete-set-testnet-policy.md
updated: 2026-07-07
---

# CreationFeeVault

Abstract base extracted from [PregradManager](pregrad-manager.md) on
2026-07-07 (cleanup program item C1, human-reviewed, landed via the
`trackc-c1-fee-manager` PR). It owns custody mechanics — fee collection
accounting, withdrawal guards, fee errors/events — while PregradManager keeps
policy: `MARKET_CREATION_FEE = 1e18` native units, the trusted-creator waiver,
and the `onlyOwner` withdrawal gate.

Deliberately named CreationFeeVault rather than the ADR's working name
"FeeManager": it is custody, not policy. The extraction was proven
behavior-preserving by zero-diff ABI regeneration and 173-test parity.

## Caveats

- [Protocol ADR 0009](../summaries/protocol-adr-0009-complete-set-testnet-policy.md)
  still says the owner withdraws fees "from PregradManager" — written before
  the extraction; the observable behavior is unchanged (zero-diff ABI).
- The mechanism whitepaper charges **no fees** and requires any future fee to
  appear explicitly in the accounting identity (`E = R + L + fees`, never
  implicitly). Creation fees sit outside the receipt-escrow identity — see
  [creation-fee custody](../concepts/creation-fee-custody.md).

## Related pages

- [Creation-fee custody](../concepts/creation-fee-custody.md)
