---
type: concept
title: AI-assisted resolution
description: The post-graduation outcome pipeline — a resolution service + leased runner deciding resolve/cancel/too_early from public evidence, with abstention, per-outcome temporal gates, and a local (not API) operator override; detailed design accepted, build underway.
sources:
  - docs/ai-resolution-service-design.md
  - docs/adr/0012-ai-assisted-resolution.md
  - docs/adr/0011-ai-review-service-hardening.md
  - documents/whitepaper_v3.pdf
  - documents/whitepaper_v0_1.pdf
updated: 2026-07-13
---

# AI-assisted resolution

**Status: detailed design accepted, build underway.** The implementation design
([AI resolution service & runner design](../summaries/ai-resolution-service-design.md),
2026-07-09) that [root ADR 0012](../summaries/root-adr-0012-ai-assisted-resolution.md)
required now exists, and the resolution runner's on-chain transition, config,
and client have begun landing — the ADR 0012 doc checklist still reads all ten
items open, so the code is ahead of the checklist. Distinct from
[AI review](../entities/ai-review-service.md), which gates market *creation*;
resolution decides the *outcome* of graduated markets — "the highest-stakes
automation in the system" (an AI holding a resolver key).

## Planned shape

- A sibling of the review architecture: stateless service + DB-leased runner
  + append-only audit (`market_resolutions` + `market_resolution_jobs`),
  submitting `resolve(side)`/`cancel()` on the
  [postgrad market](../entities/postgrad-market.md) for graduated markets.
  Status propagation is the indexer's job (a new
  `MarketResolved`/`MarketCancelled` watcher), not a runner UPDATE, because
  override and self-resolve are also actors.
- **Per-outcome temporal gates** (the design's load-bearing addition): a single
  `resolutionTime` is insufficient. `no_not_before` **is** the on-chain
  `resolution_time`; `yes_not_before` is a **new on-chain `createMarket`
  parameter** allowing early YES on open-ended markets; the runner refuses a
  side before its gate, a model `too_early` outcome re-queues, and an on-chain
  `resolve` floor guard reverts before the gate even if the resolver key is
  compromised (closing ADR 0008's on-chain-gating item). Observation window is
  metadata-payload guidance (bumped to v2). See the
  [service & runner design](../summaries/ai-resolution-service-design.md).
- Safety valves: abstention threshold **0.85** + ≥1 surviving evidence item
  (low confidence → manual review); **draws always park** for an operator; an
  operator delay/override window (**24h on Arc, 0 on local**). The override is a
  local admin action against the chain and job queue (a keyed admin panel),
  never an API endpoint (root ADR 0009). Shares the hardened safe-web evidence
  path with review (root ADR 0011).
- `bypassAiResolution` semantics are now designed: a trusted creator's
  `bypass = true` market is not auto-discovered and resolves through an
  operator-authenticated **self-resolve** endpoint (audited as
  `provider = 'manual'`), included in the first build behind a cloned env-flag
  auth seam; coordinated with the resolver entry points
  ([root ADR 0008](../summaries/root-adr-0008-protocol-functionality-completion.md)).

## Provenance caveat

Whitepaper v4 deliberately drops resolution as a modular layer. The richer
optimistic pipeline (AI proposes with evidence bundle → challenge window →
bonded dispute → human review → arbitration backstop) and the market-rule
JSON schema ("to prevent the market maker from becoming the court") come from
the superseded v0.1/v3 drafts — cite those, not v4. See
[mechanism whitepaper](mechanism-whitepaper.md).
