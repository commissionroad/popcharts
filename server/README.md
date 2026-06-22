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

## Local AI Review

The AI review service is a separate local HTTP server for market moderation and
knowability checks. It uses Ollama for the model call and a restricted web
evidence collector for URL/search access.

Ollama models do not browse the internet by themselves. The service fetches
safe public evidence first, then passes that evidence to the local model as
untrusted context. Localhost, private IPs, non-HTTP URLs, oversized fetches, and
unsafe redirects are blocked.

```bash
cd server
ollama pull gpt-oss:20b
bun run dev:ai-review
```

The review API listens on `http://localhost:3002` by default:

```bash
curl -s http://localhost:3002/reviews/market \
  -H 'content-type: application/json' \
  -d '{
    "metadata": {
      "question": "Will NASA announce a new Artemis launch date before July 31, 2026?",
      "description": "Resolve using a public NASA announcement or major wire coverage.",
      "resolutionCriteria": "YES if NASA publishes a new official Artemis launch date before the deadline.",
      "resolutionUrl": "https://www.nasa.gov/"
    }
  }'
```

For a no-model smoke test, set `AI_REVIEW_PROVIDER=heuristic`. To disable web
evidence collection, set `AI_REVIEW_INTERNET_ACCESS=off`; to fetch only the
provided resolution URL, set `AI_REVIEW_INTERNET_ACCESS=provided_urls`.

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
