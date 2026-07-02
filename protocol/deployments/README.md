# Protocol Deployments

`protocol.json` is the protocol-owned registry that feeds the generated public
contract metadata in `src/generated/pregrad-manager.ts`.

Each network entry keeps a stable chain id and a `contracts` object. When
`PregradManager` is deployed for a network, add:

```json
{
  "PregradManager": {
    "address": "0x0000000000000000000000000000000000000000",
    "deployBlock": "0"
  }
}
```

Use a decimal string for `deployBlock` so the generator can emit a bigint
literal without losing precision. Omit `deployBlock` if the deployment block is
not known.

## Venue And Postgrad Manifests

`pnpm arc:testnet:deploy-venue` writes `arc-testnet.venue-stack.local.json` and
`pnpm arc:testnet:deploy-postgrad` writes `arc-testnet.postgrad.local.json`
(localhost variants use the `local.` prefix). Both files use the manifest shape
checked by `pnpm deployment:check-venue`:

```bash
pnpm deployment:check-venue --manifest deployments/arc-testnet.venue-stack.local.json
pnpm deployment:check-venue --manifest deployments/arc-testnet.postgrad.local.json
```

## Explorer Verification On Arc Blockscout

Venue-stack contracts (`PoolManager`, `StateView`, `V4Quoter`,
`MinimalV4SwapRouter`) deploy through the `VenueStack` Ignition module, so
`pnpm arc:testnet:deploy-venue` verifies them automatically through
`hardhat-verify`'s Blockscout integration (configured in `hardhat.config.ts`
under `verify.blockscout` and the Arc chain descriptor). To re-run
verification for an existing deployment:

```bash
pnpm hardhat ignition verify venue-stack-arc-testnet
```

Postgrad contracts deploy outside Ignition, so verify them with the `verify`
task against the addresses in `arc-testnet.postgrad.local.json`, passing the
exact constructor arguments the deploy logged:

```bash
pnpm hardhat verify --network arcTestnet <poolTickBounds> <ownerAddress>
pnpm hardhat verify --network arcTestnet <orderManager> <poolManager> <transferApproval> <ownerAddress>
pnpm hardhat verify --network arcTestnet <postgradAdapter> <pregradManager> <ownerAddress> <resolverAddress> <outcomeDecimals>
```

`BoundedPredictionHook` is deployed through the deterministic CREATE2 factory
(`deterministicFactory` in the manifest) with the mined `hookSalt`, so the
transaction sender is the factory rather than the deployer. Blockscout still
verifies it from Solidity standard JSON input plus constructor arguments, which
is exactly what the `verify` task submits:

```bash
pnpm hardhat verify --network arcTestnet <boundedHook> <poolManager> <poolTickBounds> <orderManager>
```

If Blockscout's API rejects the automated submission, reuse the standard-JSON
helpers under `scripts/shared/explorer/` (`verifyBlockscoutStandardJson.ts`
submits Hardhat build-info standard JSON with encoded constructor args) instead
of reconstructing flattened sources.
