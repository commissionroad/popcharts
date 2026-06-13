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

Run the indexer in a second terminal after setting `PREGRAD_MANAGER_ADDRESS`:

```bash
bun run dev:indexer
```

## First Indexed Event

The first indexing slice watches `PregradManager.MarketCreated`, writes a raw
event row, and upserts a market projection for API reads. Market metadata is
stored separately by `metadataHash`; the app should eventually save metadata
through the API before submitting `createMarket` on-chain.
