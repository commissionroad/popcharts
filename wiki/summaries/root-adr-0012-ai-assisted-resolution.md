---
type: summary
title: Repo ADR 0012 — AI-assisted resolution
description: Vertical ADR to build resolution as a sibling of AI review — service + leased runner deciding resolve/cancel from public evidence, with abstention to manual review and a local (not API) operator override; all ten items open.
sources:
  - docs/adr/0012-ai-assisted-resolution.md
updated: 2026-07-09
---

# Repo ADR 0012: AI-Assisted Resolution

**Status: Accepted.** Dated 2026-07-06. Vertical checklist per ADR 0007
([summary](root-adr-0007-track-verticals-with-progress-adrs.md)).

## Context

Resolution is the second half of the AI differentiator and is currently
unbuilt. On-chain, `CompleteSetBinaryMarket` exposes a resolver role that
calls `resolve(winningOutcome)` or `cancel()` for draws; nothing decides the
outcome. Market metadata already carries the raw material — `resolutionCriteria`,
`resolutionSources`, and a `resolutionTime` deadline. The AI review vertical
proved an architecture (stateless HTTP service + DB-leased runner with an
append-only audit trail) that fits resolution almost unchanged.

## Decision

Build AI-assisted resolution as a sibling of AI review: a resolution service
evaluating a market's outcome from public evidence, and a runner polling for
markets past `resolutionTime`, persisting verdicts, and submitting
`resolve`/`cancel` on-chain. Low-confidence verdicts stop at
`manual_review`-style states rather than resolving on-chain; a human decides.
Deployment is ADR 0015.

## Progress (all items unchecked as of 2026-07-07)

Design (write up as a design doc before implementation):

- [ ] Verdict contract: outcome (yes/no/draw), confidence, evidence,
  abstention threshold below which resolution goes to manual review.
- [ ] Dispute story for testnet: at minimum a delay window between verdict and
  on-chain `resolve`, during which an operator can override.
- [ ] Resolver key custody and its relationship to the review-manager key.
- [ ] Interaction with `bypassAiResolution` (semantics finalized in ADR 0008):
  trusted creators may self-resolve; untrusted creators go through this
  service.

Implementation:

- [ ] Schema: `market_resolutions` (append-only verdicts) and
  `market_resolution_jobs` (leased queue), mirroring the review tables.
- [ ] Resolution service: provider-pluggable (heuristic/Ollama/Anthropic),
  evidence gathering via the hardened `safe-web` path (ADR 0011), prompt +
  structured output for outcome determination.
- [ ] Resolution runner: discovers markets past `resolutionTime` in status
  `graduated`, claims jobs, calls the service, persists verdicts.
- [ ] On-chain submission: `resolve`/`cancel` transactions with the review
  runner's guarded-transition pattern.
- [ ] Operator override (approve/reject/replace a pending verdict) as a local
  admin action against the chain and resolution job queue — a keyed admin
  panel, never an authenticated API endpoint (ADR 0009).
- [ ] Smoke test: seed a graduated market with known-outcome metadata, run one
  cycle, assert on-chain resolution and DB audit row.

## Exit criteria

On the devchain, a graduated market past `resolutionTime` reaches `resolved`
(or `cancelled` for a draw) with a persisted, evidence-backed verdict and no
manual steps; an ambiguous market parks in manual review and can be resolved
by an operator action.

## Consequences

An AI holding a resolver key is the highest-stakes automation in the system;
the abstention threshold and operator delay window are the safety valves, both
with conservative testnet defaults. Mirroring the review architecture doubles
the runner/service processes the stack runs; local-dev orchestration and
ADR 0015 must account for them.

## Related pages

- [../concepts/ai-assisted-resolution.md](../concepts/ai-assisted-resolution.md)
- [../entities/ai-review-service.md](../entities/ai-review-service.md)
- [../entities/postgrad-market.md](../entities/postgrad-market.md)
- [../entities/server-workspace.md](../entities/server-workspace.md)
- [../entities/devchain.md](../entities/devchain.md)
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md)
- [../concepts/complete-sets.md](../concepts/complete-sets.md)
