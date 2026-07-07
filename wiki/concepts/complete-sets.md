---
type: concept
title: Complete sets
description: The post-graduation fixed-payout object — one collateral unit backs one YES + one NO; mint/merge/redeem economics and the market-level solvency invariant.
sources:
  - documents/whitepaper_v4.pdf
  - protocol/CONTEXT.md
  - protocol/docs/adr/0008-use-complete-set-erc20-v4-markets-on-arc-testnet.md
  - protocol/docs/complete-set-v4-hook-order-manager-plan.md
updated: 2026-07-07
---

# Complete sets

A fully collateralized YES/NO pair backed by exactly one unit of collateral —
the fixed-payout object minted only from matched collateral at graduation.
The point (whitepaper v4 §2): fixed-payout claims separate prediction-market
launch from token launch — you cannot sell 100 YES at 0.05 and later owe 100.

## Economics

- Mint: 1 collateral → 1 YES + 1 NO. Merge: burn both → 1 collateral
  (pre-resolution). Resolve: winner redeems 1:1, loser expires. Cancel
  (draw): both sides redeem at half value.
- Local collateral completeness (v4 §6): `P_yes(r) + P_no(r) = 1`, so a
  matched band's YES cost + NO cost equals its width — one collateral unit
  per set, band by band, no global argument needed.
- Solvency invariant (per market): pre-resolution
  `capacity ≥ max(yesSupply, noSupply)`; post-resolution `≥ winning supply`.
  Single-sided retained mints are safe only because retained collateral
  arrived at graduation.
- Drift arbitrage keeps the two venue pools coherent: YES+NO > 1 → mint and
  sell; YES+NO < 1 → buy both and merge. Mint/merge enables solvency and
  arbitrage but does not create depth.

## Tokenization decision

"CTF-style" means these economics, not Gnosis CTF ERC1155 tokens:
[protocol ADR 0008](../summaries/protocol-adr-0008-complete-set-erc20-arc-testnet.md)
chose per-market 18-decimal ERC20 YES/NO (dust-rejecting conversions) for Arc
Testnet, a bounded deviation from ADR 0007's ERC1155 preference; mainnet
tokenization is an open future ADR. (The designkit still says "CTF YES/NO
tokens" — pre-decision language.)

## Related pages

- [Postgrad market](../entities/postgrad-market.md) — the implementation
- [Postgrad v4 venue](../entities/postgrad-v4-venue.md) — where sets trade
- [Graduation clearing](graduation-clearing.md) — where sets come from
