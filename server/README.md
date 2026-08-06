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

## Local AI Review

The AI review service is a separate local HTTP server for market moderation and
knowability checks. It can use Ollama for local model calls or Anthropic's
Claude API for cited web-search review.

Ollama models do not browse the internet by themselves. The service fetches
safe public evidence first, then passes that evidence to the local model as
untrusted context. Localhost, private IPs, non-HTTP URLs, oversized fetches, and
unsafe redirects are blocked.

With `AI_REVIEW_PROVIDER=anthropic`, the service calls Anthropic's Messages API
and enables Claude's native `web_search` and `web_fetch` tools. Hard-block
heuristics still run before the model call, and Claude search/fetch usage is
capped by the `AI_REVIEW_ANTHROPIC_MAX_WEB_*` settings.

Two providers drive a coding CLI installed on the host instead of calling an
API directly. `AI_REVIEW_PROVIDER=claude-cli` runs Claude Code in headless
print mode (`AI_REVIEW_CLAUDE_CLI_COMMAND`, `AI_REVIEW_CLAUDE_CLI_MODEL`), and
`AI_REVIEW_PROVIDER=codex-cli` runs Codex non-interactively
(`AI_REVIEW_CODEX_CLI_COMMAND`, `AI_REVIEW_CODEX_CLI_MODEL`). Both let the model
browse for itself, so neither needs pre-collected evidence. They differ in where
the browsing happens: Claude Code fetches pages from this host, while Codex's
web search runs on the provider's servers, so a Codex review host needs egress
only to the Codex API. The Codex model is pinned rather than inherited — its CLI
resolves a default from a server-side catalogue that can change tier, and cost,
without a deploy here.

`codex-cli` is the default when `AI_REVIEW_PROVIDER` is unset, so the service
needs a Codex CLI install on the host. Every other provider stays one
environment variable away.

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
      "resolutionSources": ["Official NASA announcements", "Major wire coverage"],
      "resolutionUrl": "https://www.nasa.gov/"
    }
  }'
```

For a no-model smoke test, set `AI_REVIEW_PROVIDER=heuristic`. To disable web
evidence collection, set `AI_REVIEW_INTERNET_ACCESS=off`; to fetch only
provided resolution source URLs, set `AI_REVIEW_INTERNET_ACCESS=provided_urls`.

From the repository root, `just local-dev` starts the full local app stack plus
the AI Review service and runner on the Ollama provider (the real agent-based
path). Pull the model once before relying on it:

```bash
ollama pull gpt-oss:20b   # AI_REVIEW_OLLAMA_MODEL default
```

With the runtime up and the model present, review is real: evidence is gathered
over `safe-web` and the model returns an evidence-backed verdict with scores,
one rationale per score, and source checks. Those verdicts are model judgments
and are not deterministic — a clean market may come back `manual_review` on one
run and `approve` on the next. That is expected; a parked draft lands in
`changes_requested`, which the creator can edit and resubmit.

The stock local stack gives the model five minutes, the runner six minutes, and
the database lease ten minutes. A transient runtime or model failure returns a
retryable service response: the job remains pending and no heuristic review row
or scorecard is persisted. After the retry ceiling the public market state says
review needs attention. Hard-flag rejects from the deterministic gate are still
final before any model runs. Set `AI_REVIEW_PROVIDER=heuristic` explicitly for
a no-model deterministic run. Use
`just local-ai-review` when you only want local Postgres plus the review service
and runner, without the app, API, indexer, or local chain.

For Claude web-search review:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export AI_REVIEW_PROVIDER=anthropic
export AI_REVIEW_ANTHROPIC_MODEL=claude-sonnet-4-6
bun run dev:ai-review
```

## Draft Review Runner

Review runs on drafts, before publish (ADR 0022). The runner is not a separate
process: the API server hosts it in-process and it claims draft-review jobs,
calls the AI Review service, and records the verdict on the draft. An approved
draft becomes publishable; markets are born `Active`.

Signing the publish authorization needs
`POPCHARTS_MARKET_CREATION_AUTHORIZER_PRIVATE_KEY`. Local development
(`NETWORK=local`) falls back to a built-in dev account, so only shared
deployments have to set it.

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

`POST /dev/markets/:chainId/:marketId/close` is local-development only. It is
enabled only with `POPCHARTS_DEV_TOOLS_ENABLED=true` and `NETWORK=local`, then
fast-forwards the local chain to the market graduation deadline and calls
`PregradManager.markRefundable`.
