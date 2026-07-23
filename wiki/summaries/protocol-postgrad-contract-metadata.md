---
type: summary
title: Postgrad Contract Metadata
description: Reference for how server/indexer/UI discover the postgrad venue — generated ABI modules, the three deployment manifest shapes, manifest-first vs event-first discovery, and the event/read surface of all seven venue contracts.
sources:
  - protocol/docs/postgrad-contract-metadata.md
updated: 2026-07-21
---

# Postgrad Contract Metadata

Reference documentation (not a plan) for the public metadata surface of the
complete-set postgrad and bounded v4 venue, so the
[server](../entities/server-workspace.md), [indexer](../entities/indexer.md),
and [app](../entities/app-workspace.md) can discover postgrad state from
generated ABIs, deployment manifests, and on-chain events "without hidden
local assumptions."

## Generated modules

`pnpm build` runs `protocol/scripts/export-contract-metadata.ts`, emitting
deterministic modules under `protocol/src/generated/` (checked by
`pnpm metadata:check`, re-exported from `@popcharts/protocol`):

- `pregrad-manager.ts` — `PregradManager` ABI, shared network types, and the
  `deployments/protocol.json` registry entries.
- `postgrad-venue.ts` — ABIs for the seven venue contracts, per-contract
  event-name constants (`postgradVenueEventNames`), manifest address sources
  (`postgradVenueAddressSources`), and typed singleton deployment
  placeholders (`postgradVenueDeployments`).
- `third-party/venue.ts` — compiled ABIs of the vendored third-party venue
  contracts (`poolManagerAbi`, `stateViewAbi`, `v4QuoterAbi`), so no
  workspace hand-writes fragments for them; no deployment addresses (those
  come from manifests and env config).

Each contract's address-source entry names its manifest (`venueStack`,
`postgrad`, or `market`) and a dot-notation field path. Per-market contracts
(`CompleteSetBinaryMarket`, `OutcomeToken`) are marked `perMarket: true` and
are never resolved from a singleton registry.

## Three deployment manifests

All under `protocol/deployments/` (see
[protocol deployments](protocol-deployments-readme.md)); `*.local.json` files
are run-scoped and gitignored:

1. **Venue-stack manifest** (`scripts/deploy-venue-stack.ts`) —
   `deterministicFactory`, `poolManager`, `quoter`, `stateView`, `swapRouter`,
   optional `transferApproval` (Permit2; optional on local
   [devchains](../entities/devchain.md) that don't seed it).
2. **Postgrad manifest** (`scripts/deploy-complete-set-postgrad.ts`) — adds
   `boundedHook`, `orderManager`, `poolTickBounds`, `postgradAdapter`,
   `pregradManager`, plus top-level `hookSalt` from the deterministic CREATE2
   hook deploy.
3. **Market manifest** (`scripts/create-complete-set-market.ts`, one per
   operator-created market) — market/YES/NO addresses, both pools' full
   PoolKey/PoolId, opening price, initial tick, ADR 0009 epsilon bound ticks,
   and the tx hash of every configuration write. `poolId` is
   `keccak256(abi.encode(poolKey))`, so either can be derived from the other.

## Discovery paths

- **Manifest-first**: operator-created markets are fully described by their
  market manifest.
- **Event-first**: adapter-prepared (graduated) markets have no manifest. An
  indexer starting from only singleton addresses reconstructs everything:
  `PostgradMarketPrepared` on the adapter → `yesToken()`/`noToken()` on the
  market → recompute PoolKeys/PoolIds → confirm live pools via
  `PoolTickBoundsSet` / `PoolWhitelistSet` → track maker flow via
  `OrderCreated`/`OrderFilled`/`OrderPartiallyFilled`/`OrderCancelled`/
  `OrderRequeued` and deferred batches via `DeferredExecutionStored`/
  `DeferredExecutionResolved` → track swaps via the hook's
  `BeforeSwapTickObserved`/`AfterSwapTickObserved`.
- **Pool state**: read `slot0` (sqrtPriceX96, tick, fees) through the
  `StateView` lens.

## The seven contracts

Full event tables and read helpers are in the source doc; the roster:

| Contract | Role |
| --- | --- |
| `CompleteSetBinaryMarket` | Collateralized ERC20 YES/NO market; `Trading` → `Resolved` or `Cancelled` (draw redemption). Dust-rejecting decimal conversion; `collateralOutcomeCapacity()` exposes solvency headroom. |
| `OutcomeToken` | Per-market ERC20 per outcome; only the owning market mints/burns (standard `Transfer`/`Approval` events only). |
| `CompleteSetPostgradAdapter` | Bridges finalized [pregrad manager](../entities/pregrad-manager.md) claims into postgrad markets; pregrad-manager-only `prepareMarket`/`distributeOutcome`; adapter is retained minter of markets it deploys. |
| `BoundedPoolOrderManager` | Maker orders as one-sided v4 liquidity; hook-driven fills, partial fills, requeues, deferred-execution batches; owner-set whitelist/roles/caps. |
| `BoundedPredictionHook` | Records before/after swap ticks, validates bounds, calls `movePoolTick`; CREATE2-mined address encodes permission flags. |
| `PoolTickBounds` | Owner-configured inclusive tick bounds; swaps leaving the band revert. |
| `MinimalV4SwapRouter` | ERC20-only smoke router with caller-side settlement; emits no events. |

## Related pages

- [postgrad market](../entities/postgrad-market.md)
- [complete sets](../concepts/complete-sets.md)
- [indexer](../entities/indexer.md)
- [pregrad manager](../entities/pregrad-manager.md)
- [deployment and infrastructure](../concepts/deployment-and-infrastructure.md)
- [complete-set v4 hook and order manager plan](protocol-complete-set-v4-hook-order-manager-plan.md)
- [protocol deployments](protocol-deployments-readme.md)
