# Postgrad Contract Metadata

Public metadata for the complete-set postgrad and bounded v4 venue surface, so
the server, indexer, and UI can discover postgrad state from generated ABIs,
deployment manifests, and on-chain events without hidden local assumptions.

## Generated Module Layout

`pnpm build` runs `scripts/export-contract-metadata.ts`, which emits
deterministic modules under `src/generated/` (checked by `pnpm metadata:check`):

- `src/generated/pregrad-manager.ts` — `PregradManager` ABI plus the shared
  network types (`ProtocolNetworkId`, `ProtocolContractDeployment`) and the
  `deployments/protocol.json` registry entries.
- `src/generated/postgrad-venue.ts` — ABIs for the seven contracts documented
  below, sorted per-contract event-name constants (`postgradVenueEventNames`),
  manifest address sources (`postgradVenueAddressSources`), and typed
  singleton deployment placeholders (`postgradVenueDeployments`).
- `src/generated/third-party/venue.ts` — compiled ABIs of the vendored
  third-party venue contracts (`poolManagerAbi`, `stateViewAbi`,
  `v4QuoterAbi`), so no workspace hand-writes fragments for them. Carries no
  deployment addresses; those come from manifests and env config.

The modules are re-exported from the package root (`@popcharts/protocol`);
the third-party module is also exposed as the `./third-party/venue` subpath
for consumers that avoid the root barrel.

### Joining ABIs To Manifest Addresses

Each contract's `postgradVenueAddressSources` entry names the manifest that
carries its address (`venueStack`, `postgrad`, or `market`) and the manifest
field path in dot notation. A consumer resolves an address like this:

1. Pick the manifest file for the target chain (see
   [Deployment Manifests](#deployment-manifests)).
2. Read the field named by `manifestKeys` (for singleton manifests the path is
   `contracts.<key>.address`; for market manifests the dot path is literal,
   e.g. `market.address`).
3. Attach the matching ABI export (`postgradVenueContracts[name].abi`).

Contracts marked `perMarket: true` (`CompleteSetBinaryMarket`, `OutcomeToken`)
have one instance per market, discovered from a market manifest or from the
event-first path below — never from a singleton registry entry.

Singleton addresses promoted into `deployments/protocol.json` (keyed by the
same manifest keys, e.g. `orderManager`) surface in the generated
`postgradVenueDeployments` map; networks without promoted entries stay as
typed placeholders with only their `chainId`.

## Deployment Manifests

All three manifests are written under `deployments/` and are documented in
[deployments/README.md](../deployments/README.md). The `*.local.json` files
are run-scoped and gitignored; promote durable addresses into
`deployments/protocol.json` to publish them through the generated metadata.

### Venue-Stack Manifest

Written by `scripts/deploy-venue-stack.ts`
(`<chainEnv>.venue-stack.local.json`):

```json
{
  "blockNumber": "6",
  "chainId": 31337,
  "contracts": {
    "deterministicFactory": { "address": "0x…", "required": true },
    "poolManager": { "address": "0x…", "required": true },
    "quoter": { "address": "0x…", "required": true },
    "stateView": { "address": "0x…", "required": true },
    "swapRouter": { "address": "0x…", "required": true },
    "transferApproval": { "address": "0x…", "required": false }
  },
  "deployer": "0x…",
  "generatedAt": "…",
  "rpcUrl": "…"
}
```

`transferApproval` (the canonical allowance-transfer singleton) is recorded as
optional on local devchains that do not seed it.

### Postgrad Manifest

Written by `scripts/deploy-complete-set-postgrad.ts`
(`<chainEnv>.postgrad.local.json`). Same `contracts` entry shape, plus the
top-level `hookSalt` used by the deterministic CREATE2 hook deploy:

```json
{
  "blockNumber": "11",
  "chainId": 31337,
  "contracts": {
    "boundedHook": { "address": "0x…", "required": true },
    "deterministicFactory": { "address": "0x…", "required": true },
    "orderManager": { "address": "0x…", "required": true },
    "poolManager": { "address": "0x…", "required": true },
    "poolTickBounds": { "address": "0x…", "required": true },
    "postgradAdapter": { "address": "0x…", "required": true },
    "pregradManager": { "address": "0x…", "required": true },
    "transferApproval": { "address": "0x…", "required": false }
  },
  "deployer": "0x…",
  "generatedAt": "…",
  "hookSalt": "0x…",
  "rpcUrl": "…"
}
```

### Market Manifest

Written per market by `scripts/create-complete-set-market.ts`
(`<chainEnv>.market-<symbol>.local.json`). This is the pool discovery record:
both bounded pools are persisted with their full PoolKey, PoolId, opening
price, initial tick, and the ADR 0009 epsilon bound ticks, plus the
transaction hashes of every configuration write:

```json
{
  "blockNumber": "77",
  "chainId": 31337,
  "collateral": { "address": "0x…", "decimals": 18 },
  "deployer": "0x…",
  "generatedAt": "…",
  "market": {
    "address": "0x…",
    "deploymentTransaction": "0x…",
    "name": "…",
    "noToken": "0x…",
    "outcomeDecimals": 18,
    "owner": "0x…",
    "resolver": "0x…",
    "retainedMinter": "0x…",
    "symbol": "…",
    "yesToken": "0x…"
  },
  "pools": {
    "no": {
      "boundLowerTick": -69120,
      "boundUpperTick": 0,
      "initialSqrtPriceX96": "…",
      "initialTick": -6932,
      "openingDisplayPriceWad": "500000000000000000",
      "outcomeIsCurrency0": true,
      "outcomeToken": "0x…",
      "poolId": "0x…",
      "poolKey": {
        "currency0": "0x…",
        "currency1": "0x…",
        "fee": 3000,
        "hooks": "0x…",
        "tickSpacing": 60
      },
      "transactions": {
        "initializePool": "0x…",
        "setPoolTickBounds": "0x…",
        "setPoolWhitelisted": "0x…"
      }
    },
    "yes": { "…": "same shape as no" }
  },
  "rpcUrl": "…",
  "venue": {
    "boundedHook": "0x…",
    "orderManager": "0x…",
    "poolManager": "0x…",
    "poolTickBounds": "0x…",
    "stateView": "0x…"
  }
}
```

`poolId` is `keccak256(abi.encode(poolKey))` per the v4 PoolId derivation, so
a consumer holding only the PoolKey can recompute it, and a consumer holding
only the PoolId can match it against `PoolTickBoundsSet` / `PoolWhitelistSet`
events.

## Discovery Paths

### Manifest-First (Direct Testnet Markets)

For operator-created markets, the market manifest is complete on its own:
market plus YES/NO token addresses (`market.*`), both PoolKeys and PoolIds
(`pools.yes` / `pools.no`), collateral token and decimals (`collateral`),
initial ticks and bound ticks, and every venue address the market touches
(`venue.*`).

### Event-First (No Local State)

Graduated markets are deployed by `CompleteSetPostgradAdapter`, not by a
script, so nothing writes a market manifest. An indexer that starts from only
the singleton addresses reconstructs everything on-chain:

1. `PostgradMarketPrepared(marketId, postgradMarket, collateral, …)` on the
   adapter announces each new market and its collateral.
2. `yesToken()` / `noToken()` on the announced `CompleteSetBinaryMarket` give
   both outcome-token addresses; recompute each PoolKey from
   `(outcomeToken, collateral, fee, tickSpacing, boundedHook)` with
   address-sorted currencies, then derive the PoolId.
3. `PoolTickBoundsSet(poolId, lowerTick, upperTick)` on `PoolTickBounds` and
   `PoolWhitelistSet(poolId, whitelisted)` on `BoundedPoolOrderManager`
   confirm which pools are live for bounded trading.
4. `OrderCreated` / `OrderFilled` / `OrderPartiallyFilled` / `OrderCancelled`
   / `OrderRequeued` on the order manager track maker flow;
   `DeferredExecutionStored` / `DeferredExecutionResolved` track crossed-order
   batches that exceeded the immediate execution cap.
5. `BeforeSwapTickObserved` / `AfterSwapTickObserved` on the hook track tick
   movement per swap.

### Pool State Via StateView

Pool prices live in the v4 `PoolManager`'s packed storage, so read `slot0`
through the venue `StateView` lens (address in the venue-stack manifest's
`contracts.stateView` and the market manifest's `venue.stateView`):

```solidity
function getSlot0(
  bytes32 poolId
) external view returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
```

First-party consumers call this through the compiled `stateViewAbi` in
`src/generated/third-party/venue.ts` (emitted by the metadata export alongside
`poolManagerAbi` and `v4QuoterAbi`); the market-creation flow uses it to read
back the opening price after `initialize`.

## Contracts

### CompleteSetBinaryMarket (`contracts/postgrad/CompleteSetBinaryMarket.sol`)

Fully collateralized ERC20 YES/NO complete-set market for post-graduation
trading. Lifecycle: `Trading` → `Resolved` (one winning side redeems) or
`Cancelled` (both sides redeem at draw value).

Address: market manifest `market.address` for operator-created markets, or
`PostgradMarketPrepared.postgradMarket` for adapter-prepared markets.

| Event                      | Fires when                                                                                                    | Fields                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompleteSetsMinted`       | Collateral mints equal YES and NO complete sets (`mintCompleteSets`).                                         | `caller` (supplied collateral), `to` (recipient of minted YES and NO), `collateralAmount` (deposited), `outcomeAmount` (YES and NO minted).   |
| `CompleteSetsMerged`       | Equal YES and NO tokens merge back into collateral before resolution (`mergeCompleteSets`).                   | `account` (burned complete-set tokens), `collateralAmount` (returned), `outcomeAmount` (YES and NO burned).                                   |
| `RetainedCollateralFunded` | Matched graduation collateral funds retained-claim capacity (`fundRetainedCollateral`, retained minter only). | `caller` (authorized retained minter), `collateralAmount` (deposited), `outcomeCapacity` (outcome-token capacity represented by the deposit). |
| `RetainedSideMinted`       | A retained claim mints one side of the market (`mintRetainedSide`, retained minter only).                     | `to` (recipient), `side` (YES or NO), `outcomeAmount` (minted).                                                                               |
| `MarketResolved`           | The market resolves to one winning side (`resolve`, resolver only).                                           | `side` (winning outcome side).                                                                                                                |
| `MarketCancelled`          | The market is cancelled so tokens redeem at draw value (`cancel`, resolver only).                             | none.                                                                                                                                         |
| `Redeemed`                 | Winning tokens redeem after resolution (`redeem`).                                                            | `account` (redeemer), `side` (winning side burned), `outcomeAmount` (burned), `collateralAmount` (paid).                                      |
| `CancelledRedeemed`        | Tokens redeem at draw value after cancellation (`redeemCancelled`).                                           | `account` (redeemer), `yesAmount` / `noAmount` (burned), `collateralAmount` (paid, half of gross value).                                      |

Key read helpers:

- `status()` — current lifecycle status (`Trading` / `Resolved` / `Cancelled`).
- `winningSide()` — winning side; reverts unless `Resolved`.
- `collateralToken()`, `yesToken()`, `noToken()` — the backing token and both
  outcome tokens.
- `collateralDecimals()`, `outcomeDecimals()` — decimal precisions.
- `outcomeAmountForCollateral(uint256)` / `collateralAmountForOutcome(uint256)`
  — exact decimal conversion between collateral and outcome raw units
  (reverts with `AmountHasDust` instead of rounding).
- `collateralOutcomeCapacity()` — outcome-token capacity backed by current
  collateral escrow (solvency headroom).
- `retainedMinter()`, `resolver()`, `owner()` — privileged accounts.

### OutcomeToken (`contracts/postgrad/OutcomeToken.sol`)

Per-market ERC20 token for one post-graduation binary outcome. Only the owning
market may mint or burn.

Address: market manifest `market.yesToken` / `market.noToken`, or the market's
`yesToken()` / `noToken()` views.

Events: standard ERC20 `Transfer` and `Approval` only. Mints appear as
`Transfer` from the zero address, burns as `Transfer` to the zero address,
always paired with a market event in the same transaction.

Key read helpers: `market()` (owning market allowed to mint/burn),
`decimals()` (configured outcome decimals), plus the standard ERC20 views.

### CompleteSetPostgradAdapter (`contracts/postgrad/CompleteSetPostgradAdapter.sol`)

Bridges finalized pregrad receipt claims into complete-set ERC20 postgrad
markets. Only the configured pregrad manager can prepare markets and
distribute claims; each prepared market is deployed by the adapter with the
adapter itself as retained minter.

Address: postgrad manifest `contracts.postgradAdapter`.

| Event                        | Fires when                                                                                           | Fields                                                                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `PostgradMarketPrepared`     | A finalized pregrad market receives a postgrad market (`prepareMarket`, pregrad manager only).       | `marketId` (pregrad market ID), `postgradMarket` (deployed complete-set market), `collateral` (ERC20 backing outcomes), `metadataHash` (market metadata and resolution rules), `retainedCollateral`, `completeSetCount`. |
| `RetainedOutcomeDistributed` | A finalized receipt claim mints retained outcome tokens (`distributeOutcome`, pregrad manager only). | `marketId`, `recipient` (receives outcome tokens), `side` (YES or NO), `amount` (distributed).                                                                                                                           |

Key read helpers:

- `getPreparedMarket(uint256 marketId)` — full `PreparedMarket` record
  (`market`, `collateral`, `metadataHash`, `retainedCollateral`,
  `completeSetCount`, `prepared`).
- `postgradMarket(uint256 marketId)` — complete-set market address, or zero if
  not prepared.
- `pregradManager()`, `resolver()`, `outcomeDecimals()` — adapter
  configuration applied to every deployed market.

### BoundedPoolOrderManager (`contracts/v4/BoundedPoolOrderManager.sol`)

Full-fill and deferred-execution order manager for bounded ERC20 prediction
pools. Maker orders are one-sided v4 pool liquidity, executed when the
authorized hook reports crossed tick movement.

Address: postgrad manifest `contracts.orderManager` (mirrored in the market
manifest `venue.orderManager`).

| Event                       | Fires when                                                                                          | Fields                                                                                                                                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PoolWhitelistSet`          | The owner flips a pool's maker-order whitelist flag (`setPoolWhitelisted`).                         | `poolId`, `whitelisted`.                                                                                                                                                                        |
| `HookRoleSet`               | The owner grants or revokes a hook's crossed-order execution role (`setHookRole`).                  | `hook`, `allowed`.                                                                                                                                                                              |
| `ResolverRoleSet`           | The owner grants or revokes a deferred-batch resolver role (`setResolverRole`).                     | `resolver`, `allowed`.                                                                                                                                                                          |
| `MaximumExecutionCountSet`  | The owner changes the immediate execution cap (`setMaximumExecutionCount`).                         | `maximumExecutionCount` (max crossed order IDs per batch).                                                                                                                                      |
| `MinimumOrderAmountSet`     | The owner changes a token's minimum maker input (`setMinimumOrderAmount`).                          | `token`, `minimumAmount`.                                                                                                                                                                       |
| `OrderCreated`              | A maker order is created (`createOrder`).                                                           | `poolId`, `orderId` (per-pool), `owner` (maker), `zeroForOne` (selling currency0 for currency1), `tickLower` / `tickUpper` (liquidity range), `liquidity` (added), `amountIn` (input consumed). |
| `OrderCancelled`            | The maker cancels and remaining inventory is returned (`cancelOrder`).                              | `poolId`, `orderId`, `owner`, `amount0` / `amount1` (returned).                                                                                                                                 |
| `OrderFilled`               | An order fully fills after its threshold is crossed (hook-driven `movePoolTick` or resolver batch). | `poolId`, `orderId`, `owner`, `amount0` / `amount1` (paid to the maker).                                                                                                                        |
| `OrderPartiallyFilled`      | An order partially fills and remaining liquidity is reindexed (partial-fill orders only).           | `poolId`, `orderId`, `owner`, `amount0` / `amount1` (paid), `tickLower` / `tickUpper` / `indexedTick` (updated range), `remainingLiquidity` (zero when the remainder collapsed).                |
| `OrderRequeued`             | A popped order is kept because movement did not fully cross it.                                     | `poolId`, `orderId`, `thresholdTick` (tick where the order remains indexed).                                                                                                                    |
| `DeferredExecutionStored`   | Crossed orders beyond the immediate cap are deferred for resolver work.                             | `executionId`, `poolId`, `fromTick` / `toTick` (pool ticks around the original movement), `orderCount` (order IDs stored).                                                                      |
| `DeferredExecutionResolved` | A resolver processes a deferred batch (`resolveDeferredExecution`).                                 | `executionId`, `poolId`, `processedCount` (order IDs consumed this call), `complete` (whether the batch is fully resolved).                                                                     |

Key read helpers:

- `getOrder(PoolId poolId, uint32 orderId)` — stored `Order` (`owner`,
  `zeroForOne`, `tickLower`, `tickUpper`, `indexedTick`, `liquidity`,
  `enablePartialFill`).
- `getDeferredExecution(bytes32 executionId)` — `(pending, poolId, fromTick,
toTick, sqrtPriceX96, nextOrderIndex, orderCount, remainingOrderCount)` for
  keeper backlog tracking.
- `poolWhitelisted(PoolId)`, `hookRole(address)`, `resolverRole(address)` —
  authorization state.
- `minimumOrderAmount(address token)`, `maximumExecutionCount()` — order
  policy parameters.
- `poolManager()`, `tokenPuller()` — venue dependencies.

### BoundedPredictionHook (`contracts/v4/BoundedPredictionHook.sol`)

Minimal hook that records swap ticks and enforces configured pool tick bounds;
after each swap it notifies the order manager of tick movement via
`movePoolTick`. Deployed through the deterministic CREATE2 factory so its
address encodes the beforeSwap and afterSwap permission flags.

Address: postgrad manifest `contracts.boundedHook`, with the mined CREATE2
salt in the manifest's top-level `hookSalt` (mirrored in the market manifest
`venue.boundedHook` and every pool's `poolKey.hooks`).

| Event                    | Fires when                                    | Fields                                        |
| ------------------------ | --------------------------------------------- | --------------------------------------------- |
| `BeforeSwapTickObserved` | The hook records the pool tick before a swap. | `poolId`, `tick` (pool tick before the swap). |
| `AfterSwapTickObserved`  | The hook records the pool tick after a swap.  | `poolId`, `tick` (pool tick after the swap).  |

Key read helpers:

- `lastSwapTickObservation(PoolId)` — `(observed, beforeTick, afterTick)` for
  the most recent swap.
- `hookPermissionFlags()` / `getHookPermissions()` — the permission mask the
  deployment address must encode (address mining check).
- `poolManager()`, `poolTickBounds()`, `poolOrderManager()` — wired venue
  dependencies.

### PoolTickBounds (`contracts/v4/PoolTickBounds.sol`)

Owner-configured inclusive tick bounds for bounded prediction pools. The hook
calls `validatePoolTick` before and after every swap, so swaps that leave the
band revert.

Address: postgrad manifest `contracts.poolTickBounds` (mirrored in the market
manifest `venue.poolTickBounds`).

| Event               | Fires when                                                           | Fields                                                                       |
| ------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `PoolTickBoundsSet` | A pool's inclusive tick bounds are configured (`setPoolTickBounds`). | `poolId`, `lowerTick` / `upperTick` (lowest and highest allowed pool ticks). |

Key read helpers:

- `getPoolTickBounds(PoolId)` — `(configured, lowerTick, upperTick)`.
- `validatePoolTick(PoolId, int24)` — reverts unless the tick is inside the
  configured inclusive bounds (also usable as a preflight check).

### MinimalV4SwapRouter (`contracts/v4/MinimalV4SwapRouter.sol`)

ERC20-only local smoke router for v4 pool-manager interactions (swap and
modify-liquidity with caller-side settlement). It emits no events of its own;
swap activity is observable through the hook's tick observations and pool
state.

Address: venue-stack manifest `contracts.swapRouter` (deployed by the
venue-stack Ignition module).

Key read helpers: `POOL_MANAGER()` — the pool manager this router settles
against. `swap` and `modifyLiquidity` are state-changing entrypoints for smoke
and keeper flows, not indexer reads.
