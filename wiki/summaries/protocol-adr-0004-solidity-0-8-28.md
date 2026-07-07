---
type: summary
title: "ADR 0004: Pin Solidity Compiler To 0.8.28"
description: Accepted — compiler and formatter pinned to 0.8.28 to avoid forge-std deprecation warning noise on 0.8.35; pragma ^0.8.28 leaves a small-ADR upgrade path
sources:
  - protocol/docs/adr/0004-pin-solidity-compiler-to-0-8-28.md
updated: 2026-07-07
---

# ADR 0004: Pin Solidity Compiler To 0.8.28

**Status: Accepted.**

## Decision

Pin the Hardhat compiler and the Solidity formatter target to 0.8.28 for the
first protocol scaffold in the
[protocol workspace](../entities/protocol-workspace.md).

## Context

Hardhat 3 and the viem template use Solidity 0.8.28. Newer compilers exist,
but Solidity 0.8.35 emits large volumes of warnings from the `forge-std`
dependency (future keyword and assembly-comment deprecations surfaced during
Hardhat builds).

## Consequences

- Build output stays readable and Solidity tests keep `forge-std` ergonomics
  (see [testing strategy](../concepts/testing-strategy.md)).
- The pragma range `^0.8.28` keeps future compiler upgrades possible via a
  small ADR plus a verification pass.

## Related pages

- [Summary: ADR 0001 — Hardhat 3, viem, pnpm](protocol-adr-0001-hardhat-3-viem-pnpm.md)
- [Summary: protocol README](protocol-readme.md)
