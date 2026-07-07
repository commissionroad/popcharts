---
type: summary
title: Protocol README
description: Orientation for the protocol workspace — reading order, commands, stack, PregradManager as current entry point, the postgrad testnet slice, and generated contract metadata
sources:
  - protocol/README.md
updated: 2026-07-07
---

# Protocol README

`protocol/README.md` orients contributors to the
[protocol workspace](../entities/protocol-workspace.md): a Hardhat 3 Solidity
protocol for Pop Charts, described as a "no-liquidity prediction-market
launchpad using virtual LMSR receipts and band-pass graduation clearing."

## Reading order and commands

Start-here order: `CONSTITUTION.md`, `CONTEXT.md`, `docs/CODE_GUIDELINES.md`,
`docs/TESTING.md`, then `docs/adr/`. Research plans live at
`protocol/docs/complete-set-postgrad-plan.md` and
`protocol/docs/complete-set-v4-hook-order-manager-plan.md`.

Workspace commands: `pnpm install`, `pnpm build`, `pnpm metadata:check`,
`pnpm test`, `pnpm lint:sol`, `pnpm format:check`, `pnpm typecheck`.

Stack: Hardhat 3, TypeScript + ESM, viem toolbox, Solidity tests with
`forge-std`, OpenZeppelin Contracts, pnpm (per
[ADR 0001](protocol-adr-0001-hardhat-3-viem-pnpm.md)).

## Current contract entry point

`contracts/PregradManager.sol` is the singleton manager for all
pre-graduation markets (see [pregrad manager](../entities/pregrad-manager.md)
and [ADR 0005](protocol-adr-0005-singleton-pregrad-manager.md)). It currently
supports:

- market creation, receipt placement, virtual LMSR quotes, collateral escrow
- manager-started graduation and optimistic clearing root submission
- finalizing an unchallenged clearing root, funding a postgrad adapter,
  verifying per-receipt Merkle claims, distributing retained outcomes through
  the adapter, and paying onchain refunds

Explicit status note: the protocol still does **not** compute band-pass
clearing onchain — the offchain clearing service produces the root and claim
leaves ([graduation clearing](../concepts/graduation-clearing.md),
[ADR 0006](protocol-adr-0006-optimistic-offchain-graduation-clearing.md)).
Bonded challenges and a production CTF-style postgrad adapter land in later
vertical slices.

## Postgrad testnet slice

`contracts/postgrad/OutcomeToken.sol` and
`contracts/postgrad/CompleteSetBinaryMarket.sol` implement the first Arc
Testnet postgrad building block: ERC20 YES/NO complete sets with market-level
collateral backing ([postgrad market](../entities/postgrad-market.md),
[complete sets](../concepts/complete-sets.md)).
[ADR 0008](protocol-adr-0008-complete-set-erc20-arc-testnet.md) records why
the testnet slice uses ERC20 outcome tokens while
[ADR 0007](protocol-adr-0007-ctf-style-postgrad-handoff.md) keeps the mainnet
CTF-compatible decision open.

## Public contract metadata and deployments

`pnpm build` exports generated `PregradManager` metadata from the Hardhat
artifact into `src/generated/pregrad-manager.ts`; `src/index.ts` re-exports
the ABI, deployment registry shape, optional deployment block, and typed
helpers for server/frontend imports. Deployment addresses live in
`protocol/deployments/protocol.json` — a contract entry stays absent until a
network deployment exists, and `deployBlock` is included when known. See
[deployment and infrastructure](../concepts/deployment-and-infrastructure.md).

## Related pages

- [Market lifecycle](../concepts/market-lifecycle.md)
- [Testing strategy](../concepts/testing-strategy.md)
- [Summary: Constitution](protocol-constitution.md)
