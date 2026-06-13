# Protocol Testing Strategy

Hardhat 3 supports two useful test layers. Use both intentionally.

## Solidity Tests

Solidity tests are the default for unit behavior:

- LMSR quote and cost functions
- path interval arithmetic
- receipt accounting
- clearing band math
- lifecycle transition guards
- fuzz and invariant checks

Use `forge-std/Test.sol` assertions and cheatcodes.

## TypeScript Tests

TypeScript tests are for offchain orchestration and integration:

- factory deployment
- viem typed contract interaction
- fixture reuse
- event and read-model checks
- end-to-end market flows once buying and clearing exist

Use Node's built-in test runner, `node:assert/strict`, `network.create()`, and
the viem helpers from `@nomicfoundation/hardhat-toolbox-viem`.

## Golden Tests

Before implementing real clearing, create golden tests from whitepaper v4:

- Example A: three traders, one graduation
- Example B: large drift is not backfilled

The tests should verify retained shares, retained cost, refunds, matched market
cap, and collateral completeness.

## Verification Commands

Run these before handing off protocol changes:

```bash
pnpm format:check
pnpm lint:sol
pnpm build
pnpm typecheck
pnpm test
```
