---
type: summary
title: Protocol Deployments README
description: How protocol/deployments/protocol.json feeds generated contract metadata, how venue/postgrad manifests are written and checked, and the Arc Blockscout verification workflow for each contract group.
sources:
  - protocol/deployments/README.md
updated: 2026-07-07
---

# Protocol Deployments README

Operational reference for `protocol/deployments/` in the
[protocol workspace](../entities/protocol-workspace.md). Part of the
program-wide [deployment and infrastructure](../concepts/deployment-and-infrastructure.md)
story.

## protocol.json registry

`deployments/protocol.json` is the protocol-owned registry feeding the
generated public metadata (`src/generated/pregrad-manager.ts` and
`src/generated/postgrad-venue.ts`). Each network entry has a stable chain id
and a `contracts` object:

- `PregradManager` entries carry `address` plus `deployBlock` as a decimal
  string (so the generator can emit a bigint literal; omit if unknown).
- Postgrad venue singletons use the same shape but are keyed by their manifest
  keys (`boundedHook`, `orderManager`, `poolTickBounds`, `postgradAdapter`,
  `swapRouter`) so ABIs join to addresses under the same names the manifests
  use.
- To publish a durable deployment through `postgradVenueDeployments`, copy the
  address (and deploy block) from the run-scoped `*.local.json` manifest into
  the network's `contracts` object and rerun `pnpm build`.

## Venue and postgrad manifests

- `pnpm arc:testnet:deploy-venue` → `arc-testnet.venue-stack.local.json`
- `pnpm arc:testnet:deploy-postgrad` → `arc-testnet.postgrad.local.json`
- localhost variants use the `local.` prefix
- both shapes are validated by
  `pnpm deployment:check-venue --manifest deployments/<file>`

Manifest shapes are documented in
[postgrad contract metadata](protocol-postgrad-contract-metadata.md).

## Explorer verification on Arc Blockscout

Three verification paths by contract group:

1. **Venue-stack** (`PoolManager`, `StateView`, `V4Quoter`,
   `MinimalV4SwapRouter`): deployed via the `VenueStack` Ignition module, so
   `hardhat-verify`'s Blockscout integration verifies automatically; re-run
   with `pnpm hardhat ignition verify venue-stack-arc-testnet`.
2. **Postgrad contracts** (deployed outside Ignition): manual
   `pnpm hardhat verify --network arcTestnet <address> <constructor args…>`
   against the addresses in `arc-testnet.postgrad.local.json`.
3. **BoundedPredictionHook**: deployed through the deterministic CREATE2
   factory with the mined `hookSalt` (tx sender is the factory, not the
   deployer), but Blockscout still verifies from standard JSON input +
   constructor args via the normal `verify` task.

If Blockscout's API rejects automated submission, use the standard-JSON
helpers under `scripts/shared/explorer/`
(`verifyBlockscoutStandardJson.ts`) instead of reconstructing flattened
sources.

## Related pages

- [protocol workspace](../entities/protocol-workspace.md)
- [pregrad manager](../entities/pregrad-manager.md)
- [postgrad market](../entities/postgrad-market.md)
- [deployment and infrastructure](../concepts/deployment-and-infrastructure.md)
- [postgrad contract metadata](protocol-postgrad-contract-metadata.md)
- [complete-set v4 hook and order manager plan](protocol-complete-set-v4-hook-order-manager-plan.md)
