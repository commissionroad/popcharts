# ADR 0009: Complete-Set Testnet Policy

## Status

Proposed

This ADR is pending explicit team sign-off. The defaults below are the working
policy for local and Arc Testnet operation until the open questions in the
final section are answered. Nothing here authorizes a mainnet deployment.

## Context

Protocol MVP tracker item 6 in
`docs/complete-set-v4-hook-order-manager-plan.md` requires final policy
decisions for the complete-set testnet venue: collateral choice, price/tick
display policy, liquidity caps, settlement/admin permissions, public testnet
limits, and audit-before-mainnet gates.

ADR 0008 established ERC20 complete-set markets for the Arc Testnet postgrad
venue. Several policy values are already fixed by shipped code rather than
open for debate:

- `CompleteSetBinaryMarket` takes `outcomeDecimals` at construction, converts
  between collateral and outcome precision explicitly, and rejects conversion
  dust. `CompleteSetPostgradAdapter` pins one `outcomeDecimals` value for every
  market it deploys, and `test/solidity/LocalV4StackSmoke.t.sol` exercises the
  stack with 18-decimal outcome tokens against 6-decimal collateral.
- `PoolTickBounds` enforces inclusive bounds: a tick equal to the lower or
  upper bound passes `validatePoolTick`, so exact boundary landing is allowed.
- `LocalV4StackSmoke.t.sol` runs the venue with `fee = 3000` and
  `tickSpacing = 60`.
- `PregradManager` hard-codes `MARKET_CREATION_FEE = 1e18` native units,
  waived for trusted creators, and gives the owner `setTrustedCreator` and
  `setMarketCreationPaused` controls.
- `PregradManager.isReviewManager` and `isGraduationManager` both return
  `account == owner()`, so review and graduation authority is the owner in v1.
- `CompleteSetPostgradAdapter` deploys each postgrad market with
  `retainedMinter = address(adapter)`, `owner = adapter owner`, and
  `resolver = adapter resolver`.

Where code already fixes a value, this ADR records it as decided-by-code.
Where the plan document leaves a choice open, this ADR picks one default
instead of listing options.

## Decision

### 1. Collateral

- Local tests and the first Arc Testnet smoke use the repo `MockCollateral`.
- The public Arc Testnet demo moves to Arc ERC20 USDC at
  `0x3600000000000000000000000000000000000000` only after dedicated smoke
  tests pass for its decimals, its native/ERC20 duality, and its restricted
  transfer behavior against the exact deployed market contracts.
- No other collateral token is in scope for testnet.

Mock collateral removes chain-specific transfer and decimal variables while
the venue, hook, and order-manager mechanics are validated. The 6-decimal
ERC20 USDC interface is the realistic target, but it earns its slot through
its own smoke run, not by assumption.

### 2. Price And Tick Display Policy

- Outcome token decimals: 18, configured on the postgrad adapter at
  deployment. Decided-by-code and by ADR 0008; the smoke test asserts it.
- Displayed price means collateral paid per one outcome token, in the 0-to-1
  complete-set range.
- Minimum displayed price epsilon: `0.001` collateral per outcome token.
  Display prices clamp to `[0.001, 0.999]`; quotes outside that range render
  as at-bound, never as `0` or `1`.
- Tick spacing: 60, with pool fee 3000, matching the local stack smoke.
- Bound tick rounding: derive bound ticks from the epsilon prices per pool
  sort order, then round the lower bound tick down and the upper bound tick up
  to tick-spacing multiples. The configured range may only be wider than the
  epsilon range, never narrower.
- Boundary landing: a swap landing exactly on a bound tick is allowed.
  Decided-by-code: `PoolTickBounds` bounds are inclusive.
- Because sorted currencies can put collateral on either side of a pool, and
  collateral and outcome decimals differ, every price/tick conversion helper
  must carry `outcomeIsCurrency0` plus both decimal values, with golden tests
  covering both sort orders before Arc deployment.

### 3. Liquidity Caps

Testnet numbers, explicitly arbitrary-but-capped:

- Per-market seed liquidity: at most 500 collateral units per pool, 1,000 per
  market across the YES/collateral and NO/collateral pools.
- Per-market matched market cap: at most 10,000 collateral units of locked
  collateral per graduated market.
- Total testnet cap: at most 50,000 collateral units of locked collateral
  across all live markets at once.

The exact values carry no mechanism meaning. What is load-bearing is that
caps exist, are enforced operationally by the deployer scripts and keeper
checks, and are small enough that a total loss of testnet funds is an
acceptable outcome for unaudited infrastructure.

### 4. Settlement And Admin Permissions

On testnet, a single deployer EOA holds every operational role:

- `PregradManager` owner, which decided-by-code also makes it the sole review
  manager and graduation manager, and the account that manages trusted
  creators, pauses market creation, and withdraws creation fees.
- `CompleteSetPostgradAdapter` owner and resolver, which flow into each
  deployed market: the deployer EOA becomes market owner and resolver.
- `PoolTickBounds` owner, and any hook or order-manager admin role.
- `retainedMinter` on each postgrad market is the adapter contract itself.
  Decided-by-code; no EOA ever holds retained-mint authority.

Before any mainnet deployment, owner and resolver authority must move to a
multisig, with a timelock on parameter and rescue paths. That migration is a
mainnet gate, not a testnet task.

### 5. Public Testnet Limits

- Market creation starts paused for the public via `setMarketCreationPaused`;
  only trusted creators registered through `setTrustedCreator` create markets
  during the first Arc phase.
- Creation fee: decided-by-code at `MARKET_CREATION_FEE = 1e18` native units
  for public creators, waived for trusted creators. Keep the constant as-is;
  it only binds once public creation is unpaused.
- Market count: at most 20 concurrent live markets on public testnet.
- Market size: bounded by the section 3 caps.
- Public creation unpauses only after the trusted-creator phase completes one
  full lifecycle on Arc: creation, review approval, receipts, graduation,
  clearing, claims, pool trading, resolution, and redemption.

### 6. Audit-Before-Mainnet Gates

The venue is unaudited testnet infrastructure, per the plan document's
Security Review posture:

- No mainnet deployment, and no real-value collateral anywhere, until an
  external security review of the pregrad manager, clearing commitments,
  postgrad adapter, complete-set market, hook, and order manager.
- Until then: capped market sizes and seed balances, restricted admin roles,
  and operational monitoring instead of trust in unreviewed code.
- Rescue paths gated by timelock/multisig are added before mainnet, not
  retrofitted after.
- No testnet assumption, address, key, or cap carries over to mainnet;
  mainnet gets its own ADR.

## Consequences

Testnet operation is intentionally centralized: one EOA can approve, reject,
graduate, resolve, and cancel every market. That is acceptable only because
every balance is capped, fake-or-small, and labeled unaudited. The same wiring
on mainnet would be a critical flaw, which is why section 4 and section 6 make
the multisig/timelock migration and the external review hard gates rather
than aspirations.

Recording tick spacing 60, fee 3000, 18-decimal outcome tokens, and inclusive
bound ticks as testnet defaults means scripts, manifests, golden tests, and UI
quote paths can hard-depend on them. Changing any of them later requires a
superseding ADR plus regenerated golden tests for both currency sort orders.

The epsilon and cap numbers are policy, not mechanism. They can be tuned by a
lightweight follow-up decision without touching contracts, as long as the
tuning keeps bound ranges at least as wide as the displayed range and keeps
total testnet exposure capped.

## Open Questions Requiring Sign-Off

These require explicit team answers before this ADR moves to Accepted:

1. Confirm Arc ERC20 USDC as the public-demo collateral, including the
   native-fee interaction: `MARKET_CREATION_FEE` is `1e18` native units while
   the ERC20 USDC interface uses 6 decimals, so the fee's real-world value on
   Arc must be verified before public creation unpauses.
2. Confirm the `0.001` display epsilon and the 20-market / 50,000-unit caps,
   or replace them with preferred numbers. The structure stands either way.
3. Decide whether hook fees stay disabled (zero delta) for v1, per suggested
   team question 3 in the plan document.
4. Decide whether cancellation/draw redemption at 0.5 per token is required
   for the first public testnet markets.
5. Decide whether maker seed liquidity flows only through the order manager
   or also through broad LP positions as a testnet UX backstop.
