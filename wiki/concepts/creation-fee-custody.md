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

- Whitepaper v4 charged **no fees**, requiring any future fee to appear
  explicitly in the identity. v0.6 §7 takes that option up with an entry fee
  and a withdrawal fee held outside escrow as `E = R + L + Φ`, whose proceeds
  seed the post-graduation pools
  ([protocol ADR 0014](../summaries/protocol-adr-0014-pre-graduation-withdrawals-and-fees.md)).
  The constraint is unchanged and now binds two fee surfaces rather than one:
  a fee must appear explicitly in the identity (`E = R + L + fees`) and never
  implicitly, and receipt escrow has exactly two destinations — refund or
  locked collateral — never bond/insurance/working capital. Creation fees are
  a repo extension charged at creation, outside the trade identity; wiki
  pages must not imply the whitepaper specifies them.
- Open question ([protocol ADR 0009](../summaries/protocol-adr-0009-complete-set-testnet-policy.md) Q1):
  the fee's real value under [Arc Testnet](../entities/arc-testnet.md)'s
  18-decimal-native vs 6-decimal-ERC20 USDC duality.

## Change from ADR 0022 (fee-on-accept in effect; fee indexing still open)

[Repo ADR 0022](../summaries/root-adr-0022-review-first-market-creation.md) moves
the fee to **fee-on-accept**: it is collected when the creator *publishes* an
already-approved off-chain draft, not at submit, so a rejected market never pays
(removing the reject-burns-the-fee pain). **This is in effect** as of the
2026-08-03 draft-flow build — a draft that never reaches `approved` never pays.
The ADR also notes the fee has **no event-sourced record** —
`MarketCreationFeePaid` is emitted but indexed nowhere — and adds that indexing so
the fee finally satisfies the money-paper-trail invariant. **That indexing is still
open** (it rides P4), so the creation fee remains the one value transfer without a
receipt-linked record.

ADR 0022 also introduces a **second, separate fee flow**: **prepaid review credit**
in a standalone vault, funding the AI-review pipeline as the Sybil defence. Unlike
the creation fee (an abstract base mixed into `PregradManager`, keyed to
`marketId`), it is a standalone contract keyed to the depositor's named beneficiary
and collected at submit-time when no market exists — same native-USDC `msg.value`
denomination, its own money-trail events. It **is built** (contract, meter and the
bond events indexed, 2026-08-03), so it — unlike the creation fee — already has its
receipt-linked record.

*Amended 2026-08-04:* this began as a **refundable** bond (min $5, $1/submission
incl. 5 reviews then $0.20/review, on-chain settlement, user withdrawal). Both of
its defects lived in the withdrawal path — a creator could withdraw against reviews
already consumed, and the same withdrawal could wedge settlement for that wallet
permanently — so refunds were removed rather than policed: deposits are now
non-refundable, taken via `depositFor(beneficiary)`, and spent at a single
configurable per-review-run rate. Settlement, the resolver, and user withdrawal are
deleted; the only money-trail events left are deposit and owner sweep. See the
[ADR 0022 summary](../summaries/root-adr-0022-review-first-market-creation.md).
