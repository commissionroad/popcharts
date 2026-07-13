---
type: entity
title: Postgrad v4 venue (bounded hook + order manager)
description: The Uniswap v4 trading layer for postgrad markets — BoundedPredictionHook, BoundedPoolOrderManager, PoolTickBounds, and MinimalV4SwapRouter over two pools per market.
sources:
  - protocol/docs/complete-set-v4-hook-order-manager-plan.md
  - protocol/docs/postgrad-contract-metadata.md
  - protocol/docs/adr/0008-use-complete-set-erc20-v4-markets-on-arc-testnet.md
  - protocol/deployments/README.md
updated: 2026-07-07
---

# Postgrad v4 venue

The self-hosted Uniswap v4 stack where postgrad outcome tokens trade (Arc
Testnet has no official v4 deployment, so Pop Charts deploys its own:
PoolManager, StateView, V4Quoter, plus the contracts below under
`protocol/contracts/v4/` and `protocol/contracts/postgrad/`).

## Shape

- **Two pools per market** — YES/collateral and NO/collateral. The pool IS the
  venue; there is no separate CLOB. No cross-pool YES+NO≈1 constraint in v1 —
  keeper arbitrage handles drift (mint sets and sell when YES+NO > 1, buy both
  and merge when < 1).
- **BoundedPredictionHook** — one hook on both pools; its address is
  CREATE2-mined so the low bits encode v4 permission flags (`hookSalt` in the
  postgrad manifest). Emits tick-observation events for price history.
- **BoundedPoolOrderManager** — turns maker orders into one-sided v4
  liquidity; order create/cancel/fill/requeue/partial/deferred-execution
  events feed the indexer. At 1,273 lines it has open decompositions C4/C5/C6
  in the [cleanup program](../summaries/root-adr-0016-monorepo-architecture-cleanup-program.md).
- **PoolTickBounds** — inclusive tick bounds per pool; testnet defaults tick
  spacing 60, fee 3000; display prices clamp to [0.001, 0.999].
- **MinimalV4SwapRouter** — taker swaps.

## Discovery and deployment

Venue singletons live in the venue-stack manifest (`boundedHook`,
`orderManager`, `poolTickBounds`, `postgradAdapter`, `swapRouter`); pool IDs
recompute as `keccak256(abi.encode(poolKey))` from market token addresses.
Verified on Arc Blockscout per [protocol deployments README](../summaries/protocol-deployments-readme.md).
Smoke-tested locally only; server/app integration is upcoming
([devchain](devchain.md) deploys the full stack locally).

## Related pages

- [Postgrad market](postgrad-market.md) — the tokens these pools trade
- [Arc Testnet](arc-testnet.md) — why the stack is self-hosted
- [Indexer](indexer.md) — event-first reconstruction path
