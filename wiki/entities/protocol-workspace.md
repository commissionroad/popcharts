---
type: entity
title: protocol/ workspace
description: The Solidity workspace — Hardhat 3 + viem + pnpm, pinned solc 0.8.28, contracts, deploy/ops scripts, and the generated contract-metadata pipeline.
sources:
  - protocol/README.md
  - protocol/CONSTITUTION.md
  - protocol/docs/adr/0001-use-hardhat-3-viem-and-pnpm.md
  - protocol/docs/adr/0004-pin-solidity-compiler-to-0-8-28.md
  - protocol/docs/CODE_GUIDELINES.md
  - docs/architecture.md
updated: 2026-07-07
---

# protocol/ workspace

Hardhat 3 project owning all Solidity contracts, deployment/ops scripts, and
the contract-metadata export pipeline. Imports nothing from other workspaces.

## Stack and conventions

- Hardhat 3 + `hardhat-toolbox-viem`, TypeScript/ESM, pnpm; Solidity tests
  (forge-std) are the default unit layer, TS for orchestration; no ethers
  helpers ([protocol ADR 0001](../summaries/protocol-adr-0001-hardhat-3-viem-pnpm.md)).
- Compiler and formatter pinned to 0.8.28 (avoids forge-std deprecation noise
  on 0.8.35); pragma `^0.8.28`; a second 0.8.26 compiler unit serves the
  vendored Uniswap v4 graph (`@uniswap/v4-core@1.0.2`, `v4-periphery@1.0.3`,
  Permit2 via `remappings.txt`).
- Code guidelines: domain language from `protocol/CONTEXT.md`, deep modules,
  custom errors, OpenZeppelin, thin external functions with math in
  unit-tested libraries, immutable market-defining config
  ([summary](../summaries/protocol-code-guidelines.md)).
- Doc discipline: CONTEXT.md is glossary-only; ADRs record hard-to-reverse
  tradeoffs; fix docs first when language drifts
  ([constitution](../summaries/protocol-constitution.md)).

## Generated artifacts

`pnpm build` runs `scripts/export-contract-metadata.ts` → deterministic
`src/generated/pregrad-manager.ts` and `src/generated/postgrad-venue.ts`,
gated in CI by `pnpm metadata:check`, re-exported from `@popcharts/protocol`
(ABIs, deployment registry shape, deploy blocks, typed helpers). The app
consumes these as a workspace dependency — hand-written ABI drift was
eliminated by cleanup program A2.

Canonical definitions live here: `MarketStatus` enum in
`contracts/types/MarketTypes.sol` and fixed-point `LmsrMath.sol` — "the
numbers that settle" ([monorepo architecture](../concepts/monorepo-architecture.md)
records the intentional duplications).

## Commands

`pnpm install / build / metadata:check / test / lint:sol / format:check /
typecheck` (build before typecheck). Verification bundle before handoff:
see [protocol testing](../summaries/protocol-testing.md). Deployments registry:
`protocol/deployments/protocol.json` ([README summary](../summaries/protocol-deployments-readme.md)).

## Related pages

- [PregradManager](pregrad-manager.md), [postgrad market](postgrad-market.md),
  [postgrad v4 venue](postgrad-v4-venue.md)
- [Testing strategy](../concepts/testing-strategy.md)
- [Mechanism whitepaper](../concepts/mechanism-whitepaper.md) — golden-test source
