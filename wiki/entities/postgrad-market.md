---
type: entity
title: CompleteSetBinaryMarket (postgrad market)
description: Fully collateralized per-market ERC20 YES/NO complete-set market — the post-graduation fixed-payout venue on Arc Testnet.
sources:
  - protocol/docs/adr/0008-use-complete-set-erc20-v4-markets-on-arc-testnet.md
  - protocol/docs/adr/0009-complete-set-testnet-policy.md
  - protocol/docs/postgrad-contract-metadata.md
  - protocol/docs/complete-set-v4-hook-order-manager-plan.md
  - docs/adr/0018-terminal-market-surface-and-redemption-ux.md
updated: 2026-07-14
---

# CompleteSetBinaryMarket

`protocol/contracts/postgrad/CompleteSetBinaryMarket.sol` (with
`OutcomeToken.sol`) — the post-graduation market: per-market ERC20 YES/NO
tokens fully backed by collateral. "CTF-style" here means complete-set
*economics* (fixed payout, mint/merge/redeem), deliberately not Gnosis CTF
ERC1155 tokenization — a bounded deviation from
[protocol ADR 0007](../summaries/protocol-adr-0007-ctf-style-postgrad-handoff.md)
recorded in [protocol ADR 0008](../summaries/protocol-adr-0008-complete-set-erc20-arc-testnet.md);
mainnet tokenization is deliberately left open.

## Behavior

- Lifecycle: Trading → Resolved (winner redeems 1:1, loser expires) or
  Cancelled (draw redemption at half value). Resolution finalizes the market.
- Mint 1 YES + 1 NO per collateral unit; merge burns both for collateral
  pre-resolution. See [complete sets](../concepts/complete-sets.md).
- 18-decimal outcome tokens with explicit collateral↔outcome conversion;
  dust-rejecting (`AmountHasDust`, exact-or-revert `_scaleAmount`).
- Solvency invariant (load-bearing): pre-resolution
  `collateral capacity ≥ max(yesSupply, noSupply)`; post-resolution
  `≥ winning supply`. Single-sided retained mints are safe only because
  retained collateral moved in at graduation.
- `collateralOutcomeCapacity()` exposes solvency headroom; privileged roles:
  `retainedMinter` (the [adapter](postgrad-adapter.md)), `resolver`, `owner`.
- `resolve(winningOutcome)` / `cancel()` exist, but nothing decides outcomes
  yet — that is the planned [AI-assisted resolution](../concepts/ai-assisted-resolution.md)
  ([root ADR 0012](../summaries/root-adr-0012-ai-assisted-resolution.md)).
- Redemption works on-chain (`redeem(side, amount)` 1:1 for winners,
  `redeemCancelled(yesAmount, noAmount)` at 50c per token on draws;
  script-verified 2026-07-14) but has **no app surface** —
  [root ADR 0018](../summaries/root-adr-0018-terminal-market-surface-and-redemption-ux.md)
  (accepted 2026-07-14, open) adds wallet-signed redemption panels and stops
  the API dropping the `postgrad` payload for cancelled markets.

## Discovery

Adapter-prepared (graduated) markets have no manifest — discovered event-first
from `PostgradMarketPrepared`; operator-created markets are manifest-first.
See [protocol postgrad contract metadata](../summaries/protocol-postgrad-contract-metadata.md).

## Related pages

- [Postgrad v4 venue](postgrad-v4-venue.md) — where these tokens trade
- [Postgrad adapter](postgrad-adapter.md) — deploys and funds graduated markets
- [Graduation clearing](../concepts/graduation-clearing.md) — where capacity comes from
- [Arc Testnet](arc-testnet.md) — deployment target and its USDC quirks
