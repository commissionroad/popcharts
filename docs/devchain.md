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
2. Runs `protocol/scripts/deploy-devchain.mjs`.
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
automated tests. Do not copy that key into any real network.

## Vercel Preview With Tenderly

Create a Tenderly Virtual Environment for the preview app. Use a Base Sepolia
fork or another EVM network that matches the app chain you want to test. Copy
the Virtual Environment RPC URL.

Deploy the preview contracts into that RPC:

```bash
POPCHARTS_RPC_URL="https://virtual.base.rpc.tenderly.co/..." \
POPCHARTS_DEPLOYER_PRIVATE_KEY="0x..." \
POPCHARTS_WRITE_APP_ENV=false \
pnpm run devchain:deploy
```

The deploy command prints the Vercel values to set. In Vercel, scope these to
Preview, or to a specific preview branch if you want isolated preview chains:

```bash
NEXT_PUBLIC_POPCHARTS_CHAIN_ENV=preview
NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_MODE=devchain
NEXT_PUBLIC_POPCHARTS_CHAIN_ID=<tenderly-chain-id>
NEXT_PUBLIC_POPCHARTS_RPC_URL=<tenderly-public-rpc-url>
NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS=<deployed-manager>
NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS=<deployed-collateral>
NEXT_PUBLIC_POPCHARTS_ENABLE_TESTNETS=true
POPCHARTS_DEVCHAIN_ENABLED=true
POPCHARTS_DEVCHAIN_PRIVATE_KEY=<preview-devchain-signer>
```

Only `NEXT_PUBLIC_*` values are exposed to the browser bundle. Keep
`POPCHARTS_DEVCHAIN_PRIVATE_KEY` server-side and scoped to Preview. Never set
`POPCHARTS_DEVCHAIN_ENABLED=true` for Production.

For a simple shared preview environment, keep one long-lived Tenderly Virtual
Environment and reset it when needed. For stricter PR isolation, create a
branch-specific Virtual Environment and use Vercel Preview branch overrides for
the RPC URL and addresses.
