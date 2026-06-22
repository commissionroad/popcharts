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

## Indexed Events

The indexer watches `PregradManager` market creation, review, receipt, and
settlement events. It writes raw event rows and updates the market projection
from chain events, including `GraduationStarted`, `ClearingRootSubmitted`,
`GraduationFinalized`, `MarketRefundsAvailable`, and receipt claim/refund
events.

`GET /markets` returns at most 200 markets sorted by latest creation time. Pass
an ISO `since` timestamp to fetch markets created after the previous cursor
time.

`POST /markets/:chainId/:marketId/graduate` is a non-mutating eligibility and
status check. A successful `graduated` response means the indexer has already
seen `GraduationFinalized` onchain; eligible bootstrap markets still need the
graduation manager to run start/root/finalize transactions.
