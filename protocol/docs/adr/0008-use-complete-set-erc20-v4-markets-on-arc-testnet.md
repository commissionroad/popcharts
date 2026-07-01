# ADR 0008: Use Complete-Set ERC20 V4 Markets On Arc Testnet

## Status

Accepted

## Context

ADR 0007 prefers CTF-style postgrad infrastructure and specifically points
toward ERC1155-compatible outcome positions where possible. That remains the
mainnet-oriented interoperability target.

For the immediate Arc Testnet venue, we want a complete-set market that can
trade through Uniswap v4 pools and a hook/order-manager layer. The external
reference protocol's public contracts use per-market ERC20 YES and NO tokens,
two outcome/collateral pools, and complete-set mint/merge/redemption economics.
Uniswap v4 pools also expect ERC20-like currencies, so the ERC20 route is the
shortest path to testing the venue mechanics on Arc.

The current protocol branch has market creation, receipt placement, graduation
start, optimistic clearing-root submission, refund marking, finalization, Merkle
proof claims, and a real postgrad adapter. The postgrad market remains
separately testable, but finalized pregrad claims can now fund and mint through
the adapter boundary.

## Decision

Use ERC20 complete-set markets for the Arc Testnet postgrad venue.

For this slice, "CTF-style" means complete-set economics and fixed-payout
solvency, not Gnosis CTF ERC1155 tokenization. Each graduated market receives
two ERC20 outcome tokens, YES and NO, backed by collateral held by the postgrad
market contract.

The first implementation will:

- use local `MockCollateral` before Arc ERC20 USDC
- use 18-decimal outcome tokens with explicit collateral/outcome conversion
- reject conversion dust rather than rounding user balances silently
- support complete-set minting, merging, resolution, redemption, and
  cancellation/draw redemption
- support retained-collateral funding plus controlled single-side retained
  claim mints
- connect retained funding and single-side retained claim mints through the
  `PregradManager` adapter once finalization is accepted

Uniswap v4 dependencies, hook mining, the order manager, Arc deployment
manifests, and keeper scripts are later phases. They should build on the tested
complete-set market instead of defining its collateral semantics implicitly.

## Consequences

This intentionally deviates from ADR 0007's preferred ERC1155-compatible
postgrad tokenization for testnet speed. The deviation is bounded to Arc Testnet
until a later ADR resolves the mainnet path: Gnosis CTF, ERC20 wrappers, CLOB,
v4 venue, or another compatible structure.

The market-level solvency invariant is load-bearing:

```txt
before resolution: collateral capacity >= max(YES supply, NO supply)
after resolution:  collateral capacity >= winning outcome supply
```

Single-sided retained claim mints are safe only when matched collateral has
already funded the market-level complete-set capacity. They are not a license
for the adapter to mint arbitrary unbacked outcome tokens.

Arc ERC20 USDC remains a separate smoke-test decision because Arc has native
USDC gas semantics and an ERC20 USDC interface with different decimals. Public
Arc demos should move to Arc ERC20 USDC only after transfer behavior, decimals,
and v4 pool math are tested against the exact market contracts.

The venue is unaudited testnet infrastructure. Market sizes, admin roles, and
seed balances should remain capped and operationally controlled until external
review.
