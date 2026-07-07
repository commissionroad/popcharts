---
type: summary
title: AI Review Next Phase (docs/ai-review-next-phase.md)
description: Post-PR-42 direction for the AI review system — one Market Review service with pluggable heuristic/ollama/anthropic providers, an indexer/service/runner split, startup validation, AWS shape, and prompt-injection defenses.
sources:
  - docs/ai-review-next-phase.md
updated: 2026-07-07
---

# AI Review Next Phase

Written after PR #42 landed the standalone AI review HTTP server under
`server/src/ai-review` (local-first, but already supporting an API-key
Anthropic Messages API mode). The doc argues the next phase should **not**
split Ollama and Anthropic into separate products: they stay provider
implementations behind one Market Review service whose contract is "given
market metadata and optional context, return a moderation and
public-knowability review." See
[AI Review service](../entities/ai-review-service.md).

## Recommendation: one service, pluggable providers

- `heuristic` — deterministic policy checks; smoke tests and hard-block
  enforcement.
- `ollama` — local model; needs pre-collected evidence (no native browsing).
- `anthropic` — API-key provider using Claude native `web_search`/`web_fetch`
  for cited public-source review.

Keeping one service keeps policy, route schemas, OpenAPI examples, result
shape, and indexer integration in one place. Split later only when a real
boundary forces it: dedicated GPU hardware for Ollama, a stronger trust
boundary for internet access, a separate worker pool for latency, distinct
trust zones (DB/chain service with no internet vs. search service with no DB
writes), independent scaling for cost/rate limits, or a complex multi-agent
research orchestrator.

## Intended runtime architecture

Three separate concerns, later detailed in the
[runner design](ai-review-runner-design.md):

- **Indexer** — pure chain ingestion; records submitted markets as
  `under_review` and moves on; never calls models or moderation policy inside
  `MarketCreated` handling ([indexer](../entities/indexer.md)).
- **AI Review service** — pure review computation; no DB polling, leasing,
  retry state, or projection writes.
- **Review runner** — the bridge: polls DB for eligible `under_review`
  markets, calls the service, persists immutable attempts, applies narrow
  status transitions. Clean failure model: chain indexing continues while the
  service/provider is down; missed reviews recover from durable DB state.

An internal operator path (`POST /admin/markets/:chainId/:marketId/review`)
should enqueue the same runner path — never a second review implementation.

## Engineering follow-ups

- **Provider interface**: a typed `ReviewProvider` registry
  (`server/src/ai-review/providers/{anthropic,heuristic,ollama,registry}.ts`)
  with capability metadata (`requiresApiKey`, `requiresLocalRuntime`,
  `supportsNativeWebSearch`, `requiresPreCollectedEvidence`,
  `canRunOffline`). `reviewer.ts` becomes orchestration: deterministic
  hard-block heuristics first, provider selection from request/env, evidence
  collection only when required, merged findings in one result shape.
- **Startup validation**: anthropic requires `ANTHROPIC_API_KEY`, validated
  base URL and search/fetch/token caps; ollama may start without model
  reachability locally (optional strict mode); heuristic is always safe.
  Per-request provider failures degrade to `manual_review` with a clear
  reason — never silent approval.
- **Health/ops**: expand `/health` into a provider/capability status report
  (active provider, model, internet-access mode, secret presence without
  values, build metadata) and add a separate `/ready` for AWS.
- **AWS/API-key mode**: PR #42's code is already close — standalone
  Bun/Elysia, env-var config, no SDK dependency. The AWS phase adds
  infrastructure, not a second app: ECS/Fargate service, Secrets Manager for
  the API key, CloudWatch logs, internal ALB, timeout/concurrency settings,
  budget caps. If co-deployed with the server, keep a separate
  process/runtime boundary while the code stays one service. See
  [deployment and infrastructure](../concepts/deployment-and-infrastructure.md).

## Security design

Deterministic hard-blocks run before any model or web access. All market text
and fetched/searched content is untrusted (question, description, resolution
criteria, submitted URL, page text, snippets, citations). Prompts must refuse
embedded instructions, never reveal prompts/policy, never call tools because
page text says to, return only the JSON contract, and cite only URLs from
allowed tools. A future narrow evidence-collector capability: http/https
only, block localhost/private IPs, limit redirects/bytes/timeouts/fetch
counts, store compact evidence records, deterministic source-tiering.

## Indexer integration plan and checklist

The suggested submitted-market flow (indexer writes `under_review` → runner
discovers, builds input from onchain context + metadata, calls service →
result persisted with chain/market/metadata-hash/provider/model/prompt
version/verdict/scores/flags/reasons/source checks/evidence → API exposes
latest review on market reads → admin tools can override). Never block the
indexer on model latency. The phase-two checklist enumerates the provider
registry, startup validation, `/health` vs `/ready`, persistence schema,
runner polling, manual trigger, retry/backoff, API read model, Anthropic
budget controls, and tests — much of which the
[runner design doc](ai-review-runner-design.md) subsequently marked
implemented.

## Related pages

- [AI-assisted resolution](../concepts/ai-assisted-resolution.md) — the
  moderation/knowability review program.
- [Market lifecycle](../concepts/market-lifecycle.md) — `under_review` →
  `bootstrap`/`rejected` transitions this system drives.
- [Server workspace](../entities/server-workspace.md) — where service,
  runner, and indexer live.
