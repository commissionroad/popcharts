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

With `AI_REVIEW_PROVIDER=anthropic`, the service calls Anthropic's Messages API.
What the model may do depends on `AI_REVIEW_EVIDENCE_MODE`. In the default
`precollected` mode the service gathers the evidence first and gives the model
no tools. In `native` mode the service enables Claude's `web_search` and
`web_fetch` tools, capped by the `AI_REVIEW_ANTHROPIC_MAX_WEB_*` settings.
Hard-block heuristics run before the model call in both modes.

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

`anthropic` is the default when `AI_REVIEW_PROVIDER` is unset, and it runs over
evidence the service collects itself: `AI_REVIEW_EVIDENCE_MODE` defaults to
`precollected` and `AI_REVIEW_SEARCH_PROVIDER` defaults to `tavily`. That path
needs `ANTHROPIC_API_KEY` and `TAVILY_API_KEY`. Set
`AI_REVIEW_SEARCH_PROVIDER=duckduckgo` for the key-free search fallback. Every
other provider stays one environment variable away.

The local stack does not use those defaults. It sets
`AI_REVIEW_PROVIDER=claude-cli`, `AI_REVIEW_EVIDENCE_MODE=native`, and
`AI_REVIEW_SEARCH_PROVIDER=duckduckgo` in
`scripts/shared/aiReview/buildAiReviewEnv.ts`, so a local stack needs no API
key. Override each one with the matching `LOCAL_AI_REVIEW_*` variable.

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
the AI Review service. That stack reviews with headless Claude Code
(`claude-cli`), which browses for itself, so it needs a logged-in Claude Code
and no API key. Set `LOCAL_AI_REVIEW_PROVIDER=ollama` to review with a local
model instead, and pull that model once first:

```bash
ollama pull gpt-oss:20b   # AI_REVIEW_OLLAMA_MODEL default
```

With the runtime up and the model present, review is real: evidence is gathered
over `safe-web` and the model returns an evidence-backed verdict with scores,
one rationale per score, and source checks. Those verdicts are model judgments
and are not deterministic — a clean market may come back `manual_review` on one
run and `approve` on the next. That is expected. A draft that does not come back
`approve` or `reject` moves to `changes_requested`, so it returns to its creator
to edit and submit again.

The stock local stack gives each model run five minutes (`AI_REVIEW_TIMEOUT_MS`)
and leases each draft review job for five minutes; a corroborated review renews
the lease between runs, so one lease never covers more than one model call. A
transient runtime or model
failure returns a retryable service response: the job remains pending and no
review row is persisted. After the retry ceiling the draft returns to `editing`.
Hard-flag rejects from the deterministic gate are still final before any model
runs. Set `AI_REVIEW_PROVIDER=heuristic` explicitly for a no-model deterministic
run. Use `just local-ai-review` when you only want local Postgres plus the
review service, without the app, API, indexer, or local chain. That command
starts no API, so it runs no draft review loop.

For Claude web-search review, opt out of the pre-collected default so the model
browses with its own tools:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export AI_REVIEW_PROVIDER=anthropic
export AI_REVIEW_EVIDENCE_MODE=native
export AI_REVIEW_ANTHROPIC_MODEL=claude-sonnet-4-6
bun run dev:ai-review
```

## Draft Review Runner

Draft review runs in-process with the API server. It is not a separate process.
`src/api/index.ts` calls `startDraftReviewRunner()` when the API runs as the
main module, so the API command starts the runner as well:

```bash
cd server
bun run dev
```

A job is enqueued when a creator submits a draft. The same transaction moves the
draft to `in_review` and inserts one `market_draft_review_jobs` row, so a review
is never queued for content that was not validated.

The runner polls that table once a second. Each sweep claims up to three due
jobs under a five-minute lease, reviews the submitted draft snapshot, and writes
one `market_draft_reviews` row. The verdict then moves the draft: `approve` to
`approved`, `reject` to `rejected`, and anything else to `changes_requested`. A
failed attempt retries with exponential backoff from 15 seconds, capped at five
minutes. After the last attempt the draft returns to `editing` and no review row
is written, so a silent failure never reaches the creator as review feedback.

Draft review defaults to the deterministic `heuristic` provider, because the loop
shares the API process. It takes the rest of its settings from the AI Review
config, but it ignores `AI_REVIEW_PROVIDER`. Set
`POPCHARTS_DRAFT_REVIEW_PROVIDER` to review drafts with a model instead.
The local stack orchestrators set it to `claude-cli` at the stack seam
(`scripts/shared/env/buildLocalServerEnv.ts`), so `just local-dev` gates drafts
with the host's logged-in CLI; `LOCAL_DRAFT_REVIEW_PROVIDER=heuristic` dials
that back.

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
