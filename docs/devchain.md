# Pop Charts Devchain Workflow

Use the devchain workflow when the app should submit real protocol
transactions without leaving the fast local feedback loop.

## Local Hardhat Chain

From the repository root:

```bash
pnpm run devchain:e2e
```

This command:

1. Starts `hardhat node` unless a JSON-RPC server is already listening at
   `http://127.0.0.1:8545`.
2. Runs `protocol/scripts/deploy-devchain.ts`.
3. Deploys `MockCollateral` and `PregradManager`.
4. Writes `protocol/deployments/devchain.local.json`.
5. Updates `app/.env.development.local` inside the marked Pop Charts devchain
   block.
6. Runs the Playwright `@chain` smoke test against the Next.js app.

To only deploy contracts into an already-running chain:

```bash
pnpm --dir protocol devchain:node
pnpm run devchain:deploy
```

The deploy script accepts these optional environment variables:

```bash
POPCHARTS_RPC_URL=http://127.0.0.1:8545
POPCHARTS_DEPLOYER_PRIVATE_KEY=0x...
POPCHARTS_DEPLOYMENT_FILE=protocol/deployments/devchain.local.json
POPCHARTS_APP_ENV_FILE=app/.env.development.local
POPCHARTS_WRITE_APP_ENV=true
```

`app/.env.development.local` is gitignored. It includes the deterministic local
Hardhat private key so the development-only API route can create markets during
automated tests. Manual `just local-dev` runs use wallet-signed creation instead.
Do not copy that key into any real network.

## Postgrad Venue Local Deployment

`just local-dev` (and `just local-smoke` / `just devchain-e2e`) deploy the
whole system, not only the pregrad contracts. After the pregrad deploy they
run, in order:

1. `local:deploy-venue` — the self-hosted v4 venue stack (PoolManager,
   StateView, V4Quoter, MinimalV4SwapRouter); writes
   `protocol/deployments/local.venue-stack.local.json`.
2. `local:deploy-postgrad` — PoolTickBounds, BoundedPoolOrderManager, the
   CREATE2-mined BoundedPredictionHook, and CompleteSetPostgradAdapter bound to
   the fresh PregradManager; writes
   `protocol/deployments/local.postgrad.local.json`.
3. `local:create-complete-set-market` — one demo complete-set market with the
   pinned symbol `PCSM` so the venue is immediately tradeable; writes
   `protocol/deployments/local.market-pcsm.local.json`.

The orchestrators read those manifests (not stdout) for addresses, print them
in the ready summary, and record them in `server/.env.local-chain` and the app
env block as documentation for the upcoming server/app integration. Pass
`--no-postgrad` to `just local-dev` to skip the venue deployment entirely.

Run the pieces individually against an already-running local chain:

```bash
just local-deploy-venue
POPCHARTS_PREGRAD_MANAGER_ADDRESS=0x... just local-deploy-postgrad
POPCHARTS_COLLATERAL_ADDRESS=0x... just local-create-complete-set-market
just local-market-health
just local-market-smoke
```

`just local-market-health` runs the read-only market health check against the
default `PCSM` market manifest (set `POPCHARTS_MARKET_SYMBOL` or
`POPCHARTS_MARKET_DEPLOYMENT_FILE` to target another market) and exits nonzero
on a collateral invariant violation. `just local-market-smoke` chains the four
protocol smoke flows — maker order, taker swap, complete-set arbitrage, and
resolution — against the same manifest. Resolution finalizes the market, so
redeploy or recreate the demo market before trading it again.

## Arc Testnet

The non-local app and server defaults point at Arc Testnet:

```bash
NEXT_PUBLIC_POPCHARTS_CHAIN_ENV=arc-testnet
NEXT_PUBLIC_POPCHARTS_CHAIN_ID=5042002
NEXT_PUBLIC_POPCHARTS_RPC_URL=https://rpc.testnet.arc.network
```

Deploy the full protocol surface to Arc Testnet from `protocol/`:

```bash
POPCHARTS_DEPLOYER_PRIVATE_KEY="0x..." \
pnpm run arc:testnet:deploy
```

Use the generated Arc deployment manifest to set the public app addresses:

```bash
NEXT_PUBLIC_POPCHARTS_CHAIN_ENV=arc-testnet
NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_MODE=devchain
NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_SIGNER=wallet
NEXT_PUBLIC_POPCHARTS_CHAIN_ID=5042002
NEXT_PUBLIC_POPCHARTS_RPC_URL=https://rpc.testnet.arc.network
NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS=<deployed-manager>
NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=<deployed-collateral>
POPCHARTS_MARKETS_CHAIN_ID=5042002
```

Only `NEXT_PUBLIC_*` values are exposed to the browser bundle. Keep
`POPCHARTS_DEVCHAIN_PRIVATE_KEY` server-side and scoped to Preview. Never set
`POPCHARTS_DEVCHAIN_ENABLED=true` for Production.

The server/indexer also defaults to Arc Testnet unless `NETWORK=local` is set
explicitly. Set `ARC_TESTNET_PREGRAD_MANAGER_ADDRESS` and
`ARC_TESTNET_PREGRAD_MANAGER_DEPLOY_BLOCK` from the deployment manifest before
starting the indexer.
