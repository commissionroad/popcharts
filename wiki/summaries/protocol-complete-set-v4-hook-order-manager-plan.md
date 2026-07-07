---
type: summary
title: Complete-Set V4 Hook And Order Manager Plan
description: Implementation blueprint for the Arc Testnet postgrad venue — ERC20 YES/NO complete-set markets, two Uniswap v4 pools per market, a bounded prediction hook, and an onchain order manager; MVP tracker shows all items done except ADR 0009 sign-off.
sources:
  - protocol/docs/complete-set-v4-hook-order-manager-plan.md
updated: 2026-07-07
---

# Complete-Set V4 Hook And Order Manager Plan

The detailed implementation plan for the full complete-set post-graduation
trading venue on Arc Testnet. Expands the earlier
[complete-set postgrad plan](protocol-complete-set-postgrad-plan.md) into a
phased blueprint. Doc status: "implementation in progress; Phase 3 hardening
completed 2026-06-23" — but its own MVP tracker and the repo show essentially
everything has landed (see Status below).

## Executive recommendation

Build a **slim** Pop Charts complete-set v4 venue without rewriting Uniswap v4
core: self-deploy only the needed canonical v4 pieces on Arc Testnet, build a
smaller hook + order manager than the external reference protocol, keep
oracle/council/bond/tokenomics out of scope, and keep the
[pregrad manager](../entities/pregrad-manager.md) handoff boundary
receipt-centric. Explicitly unaudited testnet-only infrastructure: capped
market sizes, admin-restricted deployment, mandatory CTF/wrapper/CLOB revisit
before mainnet.

## Mental model: the pool IS the venue

There is no separate CLOB with priority over an AMM. The v4 pool is the
execution engine for all trades; the "book" is a controller around v4
liquidity:

```
taker swap -> v4 pool price moves -> hook sees tick movement
           -> order manager processes crossed maker liquidity
           -> order book state updates
```

Maker orders become one-sided v4 concentrated-liquidity positions; the hook's
`afterSwap` calls `OrderManager.movePoolTick(...)` to fill/requeue crossed
orders. Complete-set mint/merge enables arbitrage and solvency but does not
create depth by itself.

## Key facts and decisions

- **Arc Testnet**: chain ID `5042002`, RPC `https://rpc.testnet.arc.network`.
  Native gas token is USDC with an unusual dual model: 18-decimal native
  accounting vs a 6-decimal ERC20 interface at `0x3600…0000`. Pools must use
  the ERC20 interface, never native units. CREATE2, Multicall3, and Permit2
  exist on Arc; **no official Uniswap v4 deployment** was found (RPC bytecode
  probe 2026-06-22), so the v4 stack is self-deployed.
- **Tokenization deviation**: ERC20 YES/NO outcome tokens with complete-set
  economics — "CTF-style" economics, deliberately NOT Gnosis CTF ERC1155
  tokenization as ADR 0007 preferred. ADR 0008
  (`protocol/docs/adr/0008-use-complete-set-erc20-v4-markets-on-arc-testnet.md`,
  exists in repo) records the testnet-only deviation.
- **Solvency invariant is market-level, not claim-by-claim**: matched
  collateral funds complete-set capacity once; the market must always cover
  `max(yesSupply, noSupply)` before resolution and the winning supply after.
  Single-sided retained mints are allowed only because retained collateral was
  transferred in at graduation.
- **18-decimal outcome tokens** with explicit collateral↔outcome conversion;
  conversion dust is rejected, not rounded.
- **Hook fees deferred**; hook mined for `beforeSwap`/`afterSwap` only at
  first. **No cross-pool `YES + NO ≈ 1` constraint in v1** — complete-set
  arbitrage plus a keeper handle drift.
- **MockCollateral before Arc ERC20 USDC**; broad dev LP liquidity allowed
  only as a clearly marked testnet backstop after the order-manager maker path
  is proven.
- **Dependency setup (Phase 1, resolved)**: multi-compiler Hardhat (0.8.28 +
  0.8.26), pinned `@uniswap/v4-core@1.0.2` and `@uniswap/v4-periphery@1.0.3`,
  Permit2 remapped through v4-periphery's vendored copy
  (`protocol/remappings.txt`). Keep one v4-core source graph per compilation
  unit (identically named types from different paths are distinct).
- **MinimalV4SwapRouter** instead of Universal Router (whose constructor wants
  WETH9/v2/v3/Across dependencies that don't fit Arc).

## Architecture (contracts)

Pregrad → postgrad flow: `PregradManager` finalizes →
`CompleteSetPostgradAdapter` → `CompleteSetBinaryMarket` (YES/NO ERC20s +
collateral escrow) → two v4 pools (`YES/collateral`, `NO/collateral`) → one
`BoundedPredictionHook` on both pools → `BoundedPoolOrderManager` + tick
order book. `PoolTickBounds` enforces epsilon-bounded 0-to-1 price bands per
pool (no exact tick for price 0/1). Adapter never computes clearing; it only
receives manager-verified claim data. See
[postgrad market](../entities/postgrad-market.md) and
[complete sets](../concepts/complete-sets.md).

## Phase status (per the doc's own result notes)

- Phases 1–8 all have recorded results: dependency spike, local v4 stack smoke
  (`LocalV4StackSmoke.t.sol`), complete-set market + hardening
  (`CompleteSetBinaryMarket.t.sol`), hook skeleton + price bounds, order
  manager v1 (full fill), partial fill + deferred execution (deferred
  *payment* remains unimplemented, optional), pregrad adapter, and Arc
  deployment scripting.
- MVP tracker: items 1–5 (deployment scripts/manifests, market creation
  script, smoke scripts, keeper/operator scripts, public contract metadata)
  all **done**; item 6 (final policy decisions, ADR 0009) is **proposed,
  pending team sign-off**.

Repo verification (2026-07-07): all named contracts exist under
`protocol/contracts/postgrad/` and `protocol/contracts/v4/`; all named
scripts exist under `protocol/scripts/` (note: the venue check and manifest
writer landed as `.ts`, not the planned `.mjs`); ADRs 0008 and 0009 exist;
`protocol/src/generated/postgrad-venue.ts` exists.

## Related pages

- [complete sets](../concepts/complete-sets.md)
- [postgrad market](../entities/postgrad-market.md)
- [pregrad manager](../entities/pregrad-manager.md)
- [graduation clearing](../concepts/graduation-clearing.md)
- [market lifecycle](../concepts/market-lifecycle.md)
- [deployment and infrastructure](../concepts/deployment-and-infrastructure.md)
- [postgrad contract metadata](protocol-postgrad-contract-metadata.md)
- [protocol deployments](protocol-deployments-readme.md)
