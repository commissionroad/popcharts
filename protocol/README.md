# Pop Charts Protocol

Hardhat 3 Solidity protocol for Pop Charts: a no-liquidity prediction-market
launchpad using virtual LMSR receipts and band-pass graduation clearing.

Start here:

1. `CONSTITUTION.md`
2. `CONTEXT.md`
3. `docs/CODE_GUIDELINES.md`
4. `docs/TESTING.md`
5. `docs/adr/`

## Commands

```bash
pnpm install
pnpm build
pnpm metadata:check
pnpm test
pnpm lint:sol
pnpm format:check
pnpm typecheck
```

## Stack

- Hardhat 3
- TypeScript and ESM
- viem toolbox
- Solidity tests with `forge-std`
- OpenZeppelin Contracts
- pnpm

## Current Contract Entry Point

`contracts/PregradManager.sol` is the singleton manager for all pre-graduation
markets. It currently supports market creation, receipt placement, virtual LMSR
quotes, collateral escrow, manager-started graduation, and optimistic clearing
root submission. Claims, challenges, refunds, and postgrad token handoff will
land in later vertical slices.

## Public Contract Metadata

`pnpm build` exports generated `PregradManager` metadata from the Hardhat
artifact into `src/generated/pregrad-manager.ts`. The package entrypoint at
`src/index.ts` re-exports the ABI, deployment registry shape, optional
deployment block, and typed helpers for future server/frontend imports.

Deployment addresses live in `deployments/protocol.json`. Leave a contract
entry absent until a network deployment exists; include `deployBlock` when the
deployment block is known.
