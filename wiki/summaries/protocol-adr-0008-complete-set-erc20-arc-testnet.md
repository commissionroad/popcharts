---
type: summary
title: "ADR 0008: Use Complete-Set ERC20 V4 Markets On Arc Testnet"
description: Accepted — the Arc Testnet postgrad venue uses per-market ERC20 YES/NO complete sets (a bounded deviation from ADR 0007's ERC1155 preference) with a load-bearing market-level solvency invariant
sources:
  - protocol/docs/adr/0008-use-complete-set-erc20-v4-markets-on-arc-testnet.md
updated: 2026-07-07
---

# ADR 0008: Use Complete-Set ERC20 V4 Markets On Arc Testnet

**Status: Accepted.** Deliberately and boundedly deviates from
[ADR 0007](protocol-adr-0007-ctf-style-postgrad-handoff.md)'s ERC1155
preference — the deviation is limited to Arc Testnet until a later ADR
resolves the mainnet path (Gnosis CTF, ERC20 wrappers, CLOB, v4 venue, or
another compatible structure).

## Decision

Use ERC20 complete-set markets for the Arc Testnet postgrad venue. For this
slice, "CTF-style" means complete-set economics and fixed-payout solvency,
**not** Gnosis CTF ERC1155 tokenization. Each graduated market gets two ERC20
outcome tokens (YES and NO) backed by collateral held by the postgrad market
contract. See [postgrad market](../entities/postgrad-market.md) and
[complete sets](../concepts/complete-sets.md).

First implementation scope:

- local `MockCollateral` before Arc ERC20 USDC
- 18-decimal outcome tokens with explicit collateral/outcome conversion
- reject conversion dust rather than silently rounding user balances
- complete-set minting, merging, resolution, redemption, and
  cancellation/draw redemption
- retained-collateral funding plus controlled single-side retained claim
  mints
- retained funding and single-side retained claim mints connected through the
  `PregradManager` adapter once finalization is accepted
  ([pregrad manager](../entities/pregrad-manager.md))

Uniswap v4 dependencies, hook mining, the order manager, Arc deployment
manifests, and keeper scripts are later phases that build on the tested
complete-set market.

## Context

ADR 0007's ERC1155/CTF target remains mainnet-oriented. For Arc Testnet, the
venue should trade through Uniswap v4 pools and a hook/order-manager layer;
the external reference protocol uses per-market ERC20 YES/NO tokens with two
outcome/collateral pools, and v4 pools expect ERC20-like currencies — so
ERC20 is the shortest path to testing venue mechanics. The protocol branch at
decision time already had the full pregrad flow through Merkle claims and a
real postgrad adapter.

## Consequences

- Load-bearing market-level solvency invariant:

  ```txt
  before resolution: collateral capacity >= max(YES supply, NO supply)
  after resolution:  collateral capacity >= winning outcome supply
  ```

- Single-sided retained claim mints are safe only when matched collateral has
  already funded market-level complete-set capacity; the adapter has no
  license to mint unbacked outcome tokens.
- Arc ERC20 USDC is a separate smoke-test decision: Arc has native USDC gas
  semantics and an ERC20 USDC interface with different decimals. Public Arc
  demos move to it only after transfer behavior, decimals, and v4 pool math
  are tested against the exact market contracts (policy finalized in
  [ADR 0009](protocol-adr-0009-complete-set-testnet-policy.md)).
- The venue is unaudited testnet infrastructure: market sizes, admin roles,
  and seed balances stay capped and operationally controlled until external
  review (see
  [deployment and infrastructure](../concepts/deployment-and-infrastructure.md)).

## Related pages

- [Graduation clearing](../concepts/graduation-clearing.md)
- [Testing strategy](../concepts/testing-strategy.md)
- [Summary: protocol README](protocol-readme.md) — names the shipped
  contracts (`OutcomeToken.sol`, `CompleteSetBinaryMarket.sol`)
