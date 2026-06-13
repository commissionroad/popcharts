# ADR 0001: Use Hardhat 3, Viem, And pnpm

## Status

Accepted

## Context

The protocol is new Solidity work for the EVM. We need a modern local
development stack with Solidity tests, TypeScript integration tests, typed
contract interaction, and room for deployment scripts.

## Decision

Use Hardhat 3 with `@nomicfoundation/hardhat-toolbox-viem`, TypeScript, ESM, and
pnpm.

## Consequences

Solidity tests become the default unit-test layer. TypeScript tests use Node's
test runner and viem for typed contract interaction. Builds should run before
TypeScript checks so generated artifacts are available.

The protocol will not use ethers-specific helpers unless a future ADR reverses
this decision.
