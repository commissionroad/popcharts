---
type: summary
title: Complete-Set Postgrad Market Plan
description: First-pass research (2026-06-19) that chose ERC20 complete-set markets over Gnosis CTF for the testnet postgrad venue and confirmed Arc Testnet has no official Uniswap v4 deployment; superseded in detail by the v4 hook/order-manager plan.
sources:
  - protocol/docs/complete-set-postgrad-plan.md
updated: 2026-07-07
---

# Complete-Set Postgrad Market Plan

The research document (status: planning, researched 2026-06-19) that set the
direction for the post-graduation trading venue. Its successor,
[complete-set v4 hook and order manager plan](protocol-complete-set-v4-hook-order-manager-plan.md),
assumes this direction and expands it into the implementation blueprint — read
this page for the *why*, that page for the *how* and current status.

## Research answers

1. **Is Uniswap v4 deployed on Arc Testnet?** No confirmed official
   deployment. Arc docs list Permit2, CREATE2, Multicall3 — not PoolManager,
   PositionManager, StateView, Quoter, or Universal Router. Direct RPC
   bytecode checks (2026-06-19, block 47732549) found code only at Permit2.
   Implication: make v4 addresses explicit deployment inputs and fail fast if
   they have no bytecode.
2. **How does the external reference venue use v4?** Per-market ERC20 YES/NO
   tokens, two dedicated pools per market, a custom hook (`beforeSwap` /
   `afterSwap`), a swap validator enforcing per-pool tick bounds, and an order
   manager that turns maker orders into v4 liquidity positions.
3. **Does the reference protocol use Gnosis CTF?** No — per-market mintable
   ERC20s, not ERC1155 CTF positions. So Pop Charts should not add Gnosis CTF
   just to copy it. Two explicit options: testnet-fast path (ERC20
   complete-set market, "CTF-style economics, not Gnosis CTF tokenization") or
   compatibility path (Conditional Tokens + ERC20 wrappers). The plan chose
   the testnet-fast path; the deviation from ADR 0007 is recorded in a new ADR
   (landed as ADR 0008).

## Fit with Pop Charts invariants

The postgrad layer begins only after graduation clearing finalizes and must
not reinterpret pre-graduation receipts as fills:

- no final outcome token before graduation
- matched receipt segments mint fully collateralized
  [complete sets](../concepts/complete-sets.md)
- unmatched segments refund at exact recorded path cost
- `retainedCost + refund = receipt.cost`
- locked collateral equals maximum winner payout

The adapter receives only finalized retained collateral and retained YES/NO
claim amounts from the [pregrad manager](../entities/pregrad-manager.md);
refunds stay in the manager.

## Proposed architecture

`OutcomeToken`, `CompleteSetBinaryMarket` (mint/merge/resolve/redeem, optional
cancel/draw at half value), `CompleteSetPostgradAdapter`, and a minimal
bounded prediction hook under `protocol/contracts/postgrad/` — deliberately
avoiding direct import of reference contracts (Base/TYD/upgradeable/oracle
assumptions, Solidity version mismatch) and of old Gnosis CTF (Solidity
^0.5.1, ERC1155 vs v4's ERC20 currencies). Deployment manifests plus
check/deploy/seed scripts with explicit testnet-only flags.

## Risks flagged

Independent YES/NO pools drift without cheap complete-set arbitrage;
self-deployed v4 is unofficial; hook addresses encode permissions (not an
ordinary deployment); Arc USDC's 18-decimal native vs 6-decimal ERC20 duality;
copying the reference hook/order-manager wholesale imports large audit
surface.

## Status

All open questions in this doc were subsequently answered by the successor
plan and by ADRs 0008/0009 (both exist under `protocol/docs/adr/`). The
proposed contracts exist in the repo (`protocol/contracts/postgrad/`,
`protocol/contracts/v4/`), including the pregrad adapter phase this doc
records as wired. Treat this page as historical rationale, not current state.

## Related pages

- [complete sets](../concepts/complete-sets.md)
- [postgrad market](../entities/postgrad-market.md)
- [pregrad manager](../entities/pregrad-manager.md)
- [graduation clearing](../concepts/graduation-clearing.md)
- [market lifecycle](../concepts/market-lifecycle.md)
- [complete-set v4 hook and order manager plan](protocol-complete-set-v4-hook-order-manager-plan.md)
