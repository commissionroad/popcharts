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

## Proposed change (ADR 0022, Proposed — not yet built)

[Repo ADR 0022](../summaries/root-adr-0022-review-first-market-creation.md) moves
the fee to **fee-on-accept**: it is collected when the creator *publishes* an
already-approved off-chain draft, not at submit, so a rejected market never pays
(removing the reject-burns-the-fee pain). It also notes the fee currently has **no
event-sourced record** — `MarketCreationFeePaid` is emitted but indexed nowhere —
and adds that indexing so the fee finally satisfies the money-paper-trail invariant.

ADR 0022 also introduces a **second, separate fee flow**: a prepaid refundable
**review bond** in a standalone `ReviewBondVault` escrow (min $5, drawn down by
$1/submission-incl.-5-reviews then $0.20/review, no slashing), funding the AI-review
pipeline as the Sybil defence. Unlike the creation fee (an abstract base mixed into
`PregradManager`, keyed to `marketId`), the bond is a standalone contract keyed to
the submitter and collected at submit-time when no market exists — same native-USDC
`msg.value` denomination, its own deposit/settlement/withdrawal money-trail events.
