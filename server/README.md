# Pop Charts Server

Bun/Elysia API server and viem event indexer for Pop Charts.

## Stack

- Bun runtime and package manager
- Elysia with generated OpenAPI docs
- Drizzle ORM and PostgreSQL
- viem for chain reads and event subscriptions

## Local Setup

```bash
cd server
cp sample.env .env
bun install
bun run db:push
bun run dev:api
```

The API listens on `http://localhost:3001` by default. OpenAPI docs are served
at `/openapi`.

Run the indexer in a second terminal after setting
`ARC_TESTNET_PREGRAD_MANAGER_ADDRESS`:

```bash
bun run dev:indexer
```

## Local Chain Smoke

From the repository root, run the full local smoke workflow:

```bash
just setup
just local-smoke
```

It starts docker-compose Postgres, deploys local protocol contracts to a
Hardhat node, generates `server/.env.local-chain`, runs the API and indexer,
creates a market, and verifies that `GET /markets?chainId=31337` returns the
indexed market. Use `just local-smoke --keep-running` when you want to inspect
the running API/indexer after the smoke passes.

## First Indexed Event

The first indexing slice watches `PregradManager.MarketCreated`, writes a raw
event row, and upserts a market projection for API reads.

`GET /markets` returns at most 200 markets sorted by latest creation time. Pass
an ISO `since` timestamp to fetch markets created after the previous cursor
time.

`POST /markets/:chainId/:marketId/graduate` is a non-mutating stub for the
future server-mediated graduation flow.

`POST /dev/markets/:chainId/:marketId/close` is local-development only. It is
enabled only with `POPCHARTS_DEV_TOOLS_ENABLED=true` and `NETWORK=local`, then
fast-forwards the local chain to the market graduation deadline and calls
`PregradManager.markRefundable`.
