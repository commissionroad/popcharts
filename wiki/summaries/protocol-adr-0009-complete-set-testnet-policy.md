---
type: summary
title: "ADR 0009: Complete-Set Testnet Policy"
description: Proposed (pending sign-off) — working policy for the Arc Testnet venue covering collateral, price/tick display, liquidity caps, single-EOA admin, public limits, and audit-before-mainnet gates
sources:
  - protocol/docs/adr/0009-complete-set-testnet-policy.md
updated: 2026-07-07
---

# ADR 0009: Complete-Set Testnet Policy

**Status: Proposed** — pending explicit team sign-off. Its defaults are the
working policy for local and Arc Testnet operation until the open questions
are answered. Nothing in it authorizes a mainnet deployment.

## What it decides

Protocol MVP tracker item 6 in
`protocol/docs/complete-set-v4-hook-order-manager-plan.md` requires final
policy for the complete-set testnet venue established by
[ADR 0008](protocol-adr-0008-complete-set-erc20-arc-testnet.md). Several
values are recorded as **decided-by-code** (already fixed by shipped
contracts); the rest are chosen defaults.

### Collateral

- Local tests and the first Arc smoke use repo `MockCollateral`.
- The public Arc demo moves to Arc ERC20 USDC at
  `0x3600000000000000000000000000000000000000` only after dedicated smoke
  tests for its decimals, native/ERC20 duality, and restricted transfer
  behavior. No other collateral token is in testnet scope.

### Price and tick display

- Outcome decimals: 18, set on the postgrad adapter (decided-by-code;
  `test/solidity/LocalV4StackSmoke.t.sol` exercises 18-decimal outcomes
  against 6-decimal collateral).
- Displayed price = collateral per outcome token in the 0–1 complete-set
  range; display clamps to `[0.001, 0.999]` (epsilon `0.001`), never
  rendering `0` or `1`.
- Tick spacing 60, pool fee 3000, matching the local stack smoke.
- Bound ticks derive from epsilon prices, rounding lower down / upper up to
  spacing multiples; the configured range may only be wider than the epsilon
  range. Boundary landing is allowed — `PoolTickBounds` bounds are inclusive
  (decided-by-code).
- Every price/tick conversion helper must carry `outcomeIsCurrency0` plus
  both decimal values, with golden tests for both currency sort orders before
  Arc deployment ([testing strategy](../concepts/testing-strategy.md)).

### Liquidity caps (explicitly arbitrary-but-capped)

- Seed liquidity: ≤ 500 collateral units per pool, 1,000 per market.
- Matched market cap: ≤ 10,000 collateral units per graduated market.
- Total testnet: ≤ 50,000 collateral units of locked collateral at once.
- Load-bearing part: caps exist, are enforced operationally by deployer
  scripts and keeper checks, and are small enough that total loss of testnet
  funds is acceptable.

### Settlement and admin permissions

- One deployer EOA holds every operational role on testnet:
  [pregrad manager](../entities/pregrad-manager.md) owner (decided-by-code
  also the sole review manager and graduation manager —
  `isReviewManager`/`isGraduationManager` return `account == owner()` — plus
  trusted-creator management, creation pausing, and creation-fee
  withdrawal), `CompleteSetPostgradAdapter` owner and resolver (flowing into
  each deployed [postgrad market](../entities/postgrad-market.md)), and
  `PoolTickBounds`/hook/order-manager admin.
- `retainedMinter` on each postgrad market is the adapter contract itself;
  no EOA ever holds retained-mint authority (decided-by-code).
- Before mainnet: owner/resolver authority moves to a multisig with a
  timelock on parameter and rescue paths — a mainnet gate, not a testnet
  task.

### Public testnet limits

- Market creation starts paused for the public (`setMarketCreationPaused`);
  only trusted creators (`setTrustedCreator`) create markets in the first Arc
  phase.
- Creation fee: decided-by-code at `MARKET_CREATION_FEE = 1e18` native
  units for public creators, waived for trusted creators (see
  [creation fee custody](../concepts/creation-fee-custody.md) and
  [creation fee vault](../entities/creation-fee-vault.md)).
- ≤ 20 concurrent live public-testnet markets; sizes bounded by the caps
  above.
- Public creation unpauses only after trusted creators complete one full
  lifecycle on Arc: creation, review approval, receipts, graduation,
  clearing, claims, pool trading, resolution, redemption
  ([market lifecycle](../concepts/market-lifecycle.md)).

### Audit-before-mainnet gates

No mainnet deployment or real-value collateral until an external security
review of the pregrad manager, clearing commitments, postgrad adapter,
complete-set market, hook, and order manager. Until then: capped sizes,
restricted admin, operational monitoring. Rescue paths gated by
timelock/multisig are added before mainnet, not retrofitted. No testnet
assumption, address, key, or cap carries to mainnet; mainnet gets its own
ADR. See
[deployment and infrastructure](../concepts/deployment-and-infrastructure.md).

## Consequences

Testnet operation is intentionally centralized (one EOA can approve, reject,
graduate, resolve, cancel every market) — acceptable only because balances
are capped, fake-or-small, and labeled unaudited; the same wiring on mainnet
would be a critical flaw. Tick spacing 60, fee 3000, 18-decimal outcomes, and
inclusive bound ticks are hard dependencies for scripts, manifests, golden
tests, and UI quote paths; changing any requires a superseding ADR plus
regenerated golden tests for both sort orders. Epsilon and cap numbers are
policy, not mechanism, and may be tuned by lightweight follow-up.

## Open questions requiring sign-off

1. Confirm Arc ERC20 USDC as public-demo collateral, including the native-fee
   interaction (`MARKET_CREATION_FEE` is `1e18` native units while ERC20 USDC
   uses 6 decimals — the fee's real-world value on Arc must be verified).
2. Confirm the `0.001` epsilon and 20-market / 50,000-unit caps.
3. Decide whether hook fees stay disabled (zero delta) for v1.
4. Decide whether cancellation/draw redemption at 0.5 per token is required
   for the first public markets.
5. Decide whether maker seed liquidity flows only through the order manager
   or also through broad LP positions as a UX backstop.

## Related pages

- [Complete sets](../concepts/complete-sets.md)
- [Graduation clearing](../concepts/graduation-clearing.md)
- [Summary: ADR 0008 — ERC20 complete sets on Arc Testnet](protocol-adr-0008-complete-set-erc20-arc-testnet.md)
