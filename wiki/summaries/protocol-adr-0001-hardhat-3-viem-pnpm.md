---
type: summary
title: "ADR 0001: Use Hardhat 3, Viem, And pnpm"
description: Accepted — the protocol dev stack is Hardhat 3 + hardhat-toolbox-viem, TypeScript/ESM, and pnpm; Solidity tests are the default unit layer and ethers helpers are excluded
sources:
  - protocol/docs/adr/0001-use-hardhat-3-viem-and-pnpm.md
updated: 2026-07-07
---

# ADR 0001: Use Hardhat 3, Viem, And pnpm

**Status: Accepted.**

## Decision

The [protocol workspace](../entities/protocol-workspace.md) uses Hardhat 3
with `@nomicfoundation/hardhat-toolbox-viem`, TypeScript, ESM, and pnpm as its
development stack.

## Context

The protocol is new Solidity work for the EVM needing a modern local dev
stack: Solidity tests, TypeScript integration tests, typed contract
interaction, and room for deployment scripts.

## Consequences

- Solidity tests are the default unit-test layer; TypeScript tests use Node's
  test runner with viem for typed contract interaction (see
  [testing strategy](../concepts/testing-strategy.md)).
- Builds must run before TypeScript checks so generated artifacts are
  available.
- The protocol will not use ethers-specific helpers unless a future ADR
  reverses this decision.

## Related pages

- [Summary: protocol README](protocol-readme.md) — the commands and stack in
  practice
- [Summary: ADR 0004 — pin Solidity to 0.8.28](protocol-adr-0004-solidity-0-8-28.md)
