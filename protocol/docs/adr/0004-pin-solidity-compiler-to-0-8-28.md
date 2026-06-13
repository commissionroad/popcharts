# ADR 0004: Pin Solidity Compiler To 0.8.28

## Status

Accepted

## Context

Hardhat 3 and the viem template use Solidity 0.8.28. Newer compilers are
available, but Solidity 0.8.35 emits large volumes of warnings from the
`forge-std` dependency because future keyword and assembly-comment deprecations
inside that dependency are surfaced during Hardhat builds.

## Decision

Pin the Hardhat compiler and Solidity formatter target to 0.8.28 for the first
protocol scaffold.

## Consequences

Build output stays readable, Solidity tests keep `forge-std` ergonomics, and
the pragma range `^0.8.28` still makes future compiler upgrades possible via a
small ADR and verification pass.
