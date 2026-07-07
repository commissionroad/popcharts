---
type: summary
title: "ADR 0007: Handoff To A CTF-Style Postgrad Market"
description: Accepted — no bespoke postgrad market in v1; pregrad hands off through an IPostgradAdapter to CTF-style outcome infrastructure, preferring ERC1155/CTF-compatible tokens
sources:
  - protocol/docs/adr/0007-handoff-to-ctf-style-postgrad-market.md
updated: 2026-07-07
---

# ADR 0007: Handoff To A CTF-Style Postgrad Market

**Status: Accepted** (its ERC1155 preference is deliberately deviated from on
testnet by [ADR 0008](protocol-adr-0008-complete-set-erc20-arc-testnet.md)).

## Decision

Do not build a bespoke postgrad market in v1 unless integration forces it.
The pregrad protocol hands off to CTF-style outcome infrastructure through a
focused postgrad adapter whose job is to initialize or reference the postgrad
condition, split matched collateral into complete sets, and distribute
retained YES/NO balances per finalized receipt claims. See
[postgrad market](../entities/postgrad-market.md) and
[complete sets](../concepts/complete-sets.md).

Division of responsibility:

- The [pregrad manager](../entities/pregrad-manager.md) keeps receipt escrow,
  graduation start, clearing-root acceptance, finalization, refunds, and
  claim accounting.
- The postgrad layer owns transferable fixed-payout outcome tokens and later
  redemption.

The current contract captures the boundary as an `IPostgradAdapter`
interface: `finalizeGraduation` funds the adapter with retained collateral,
and per-receipt claims ask the adapter to distribute retained YES/NO
balances. A production CTF-compatible adapter is intentionally separate from
the pregrad manager.

## Context

Pop Charts is a launch mechanism, not a full post-graduation exchange. The
whitepaper's destination is a standard fully collateralized prediction
market. Polymarket's use of the Gnosis Conditional Token Framework is the
reference model: binary markets as ERC1155 outcome token IDs, complete sets
fully backed by collateral, postgrad trading through ordinary compatible
venues. An adapter layer is needed because graduation starts from pregrad
receipt outcomes, not ordinary user-initiated collateral splits.

## Consequences

- The protocol focuses on its novel part: virtual LMSR receipts and
  [graduation clearing](../concepts/graduation-clearing.md).
- Postgrad outcome tokens should be ERC1155 / CTF-compatible where possible
  for maximum interoperability.
- Boundary invariants: pregrad receipts are not outcome tokens; no outcome
  token exists before graduation finalization; complete sets are minted only
  from matched collateral; users receive postgrad balances through claims,
  never by transferring pregrad receipts.
- If a chosen postgrad venue cannot be initialized from finalized pregrad
  receipt claims without unsafe assumptions, that concern gets a new ADR
  before the pregrad mechanism changes.

## Related pages

- [Market lifecycle](../concepts/market-lifecycle.md)
- [Summary: ADR 0006 — optimistic offchain clearing](protocol-adr-0006-optimistic-offchain-graduation-clearing.md)
- [Summary: ADR 0008 — ERC20 complete sets on Arc Testnet](protocol-adr-0008-complete-set-erc20-arc-testnet.md)
