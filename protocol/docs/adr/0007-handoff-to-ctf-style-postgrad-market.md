# ADR 0007: Handoff To A CTF-Style Postgrad Market

## Status

Accepted

## Context

Pop Charts is a launch mechanism, not a full post-graduation exchange. The
whitepaper's destination is a standard fully collateralized prediction market:
matched receipts become fixed-payout YES/NO claims, unmatched receipt segments
refund, and the virtual LMSR retires.

Polymarket's Gnosis Conditional Token Framework usage is the reference model:
binary markets use ERC1155 outcome token IDs, complete sets are fully backed by
collateral, and postgrad trading can happen through ordinary order books or
other compatible venues.

Pop Charts may still need a thin adapter layer because graduation starts from
pregrad receipt outcomes rather than from ordinary user-initiated collateral
splits.

## Decision

Do not build a bespoke postgrad market in v1 unless integration forces it.

The pregrad protocol should hand off to CTF-style outcome infrastructure through
a focused postgrad adapter. That adapter's job is to initialize or reference the
postgrad condition, split matched collateral into complete sets, and distribute
retained YES/NO balances according to finalized receipt claims.

The pregrad manager remains responsible for receipt escrow, freeze, clearing
root acceptance, refunds, and claim accounting. The postgrad layer remains
responsible for transferable fixed-payout outcome tokens and later redemption.

## Consequences

The protocol can focus on its novel part: virtual LMSR receipts and graduation
clearing.

Postgrad outcome tokens should be ERC1155 / CTF-compatible where possible,
because that maximizes interoperability with existing prediction-market and
DeFi infrastructure.

The adapter boundary must be designed carefully:

- pregrad receipts are not outcome tokens
- no outcome token exists before graduation finalization
- complete sets are minted only from matched collateral
- users receive postgrad balances through claims, not by transferring pregrad
  receipts

If a chosen postgrad venue cannot be initialized from finalized pregrad receipt
claims without unsafe assumptions, that integration concern should be captured
in a new ADR before changing the pregrad mechanism.
