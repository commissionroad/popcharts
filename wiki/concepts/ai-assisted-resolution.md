---
type: concept
title: AI-assisted resolution
description: The planned post-graduation outcome pipeline — a resolution service + leased runner deciding resolve/cancel from public evidence, with abstention and operator override; unbuilt.
sources:
  - docs/adr/0012-ai-assisted-resolution.md
  - docs/adr/0011-ai-review-service-hardening.md
  - documents/whitepaper_v3.pdf
  - documents/whitepaper_v0_1.pdf
updated: 2026-07-07
---

# AI-assisted resolution

**Status: designed, unbuilt** ([root ADR 0012](../summaries/root-adr-0012-ai-assisted-resolution.md),
all ten items open). Distinct from [AI review](../entities/ai-review-service.md),
which gates market *creation*; resolution decides the *outcome* of graduated
markets — "the highest-stakes automation in the system" (an AI holding a
resolver key).

## Planned shape

- A sibling of the review architecture: stateless service + DB-leased runner
  + append-only audit (`market_resolutions` + `market_resolution_jobs`),
  submitting `resolve(winningOutcome)`/`cancel()` on the
  [postgrad market](../entities/postgrad-market.md) past `resolutionTime` for
  graduated markets. Market metadata already carries `resolutionCriteria`,
  `resolutionSources`, `resolutionTime`.
- Safety valves: abstention threshold (low confidence → manual review) and an
  operator delay/override window — both conservative on testnet. Shares the
  once-only operator-auth mechanism and hardened safe-web evidence path with
  review (root ADRs 0009/0011).
- Coupled open item: `bypassAiResolution` semantics (trusted creators
  self-resolve?) must be designed with the resolver entry points
  ([root ADR 0008](../summaries/root-adr-0008-protocol-functionality-completion.md)).

## Provenance caveat

Whitepaper v4 deliberately drops resolution as a modular layer. The richer
optimistic pipeline (AI proposes with evidence bundle → challenge window →
bonded dispute → human review → arbitration backstop) and the market-rule
JSON schema ("to prevent the market maker from becoming the court") come from
the superseded v0.1/v3 drafts — cite those, not v4. See
[mechanism whitepaper](mechanism-whitepaper.md).
