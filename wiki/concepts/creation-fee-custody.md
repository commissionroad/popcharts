---
type: concept
title: Creation-fee custody
description: Market-creation fees (1e18 native, waived for trusted creators) held by the CreationFeeVault base — custody split from policy, and kept outside the receipt-escrow identity.
sources:
  - protocol/docs/adr/0009-complete-set-testnet-policy.md
  - docs/adr/0016-monorepo-architecture-cleanup-program.md
  - documents/whitepaper_v4.pdf
updated: 2026-07-15
---

# Creation-fee custody

Pop Charts charges a market-creation fee: `MARKET_CREATION_FEE = 1e18` native
units, public creators only, waived for trusted creators, withdrawal gated to
the owner. It only binds once public creation unpauses.

## Custody/policy split (cleanup program C1, landed 2026-07-07)

- **Custody** — [CreationFeeVault](../entities/creation-fee-vault.md)
  abstract base: collection accounting, withdrawal guards, errors/events.
- **Policy** — [PregradManager](../entities/pregrad-manager.md): fee amount,
  trusted-creator waiver (`setTrustedCreator`), pause, owner gate.

## Constraints

- The whitepaper mechanism charges **no fees**; its rule is that any fee must
  appear explicitly in the identity (`E = R + L + fees`) and never
  implicitly, and receipt escrow has exactly two destinations — refund or
  locked collateral — never bond/insurance/working capital. Creation fees are
  a repo extension charged at creation, outside the trade identity; wiki
  pages must not imply the whitepaper specifies them.
- Open question ([protocol ADR 0009](../summaries/protocol-adr-0009-complete-set-testnet-policy.md) Q1):
  the fee's real value under [Arc Testnet](../entities/arc-testnet.md)'s
  18-decimal-native vs 6-decimal-ERC20 USDC duality.
