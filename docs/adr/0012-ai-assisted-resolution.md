# ADR 0012: AI-Assisted Resolution

Status: Accepted

Date: 2026-07-06

## Context

Resolution is the second half of the AI differentiator and is currently
unbuilt. On-chain, `CompleteSetBinaryMarket` exposes a resolver role that
calls `resolve(winningOutcome)` or `cancel()` for draws; nothing decides the
outcome. Market metadata already carries the raw material a resolver needs:
`resolutionCriteria`, `resolutionSources`, and a `resolutionTime` deadline.
The AI review vertical proved an architecture — stateless HTTP service plus a
DB-leased runner with an append-only audit trail — that fits resolution
almost unchanged.

## Decision

Build AI-assisted resolution as a sibling of AI review: a resolution service
that evaluates a market's outcome from public evidence, and a runner that
polls for markets past `resolutionTime`, persists verdicts, and submits
`resolve`/`cancel` on-chain. Low-confidence verdicts stop at
`manual_review`-style states rather than resolving on-chain; a human decides.
Deployment is ADR 0015.

## Progress

Design (write up as a design doc before implementation):

- [ ] Verdict contract: outcome (yes/no/draw), confidence, evidence,
      abstention threshold below which resolution goes to manual review.
- [ ] Dispute story for testnet: at minimum a delay window between verdict
      and on-chain `resolve`, during which an operator can override.
- [ ] Resolver key custody and its relationship to the review-manager key.
- [ ] Interaction with `bypassAiResolution` (semantics finalized in
      ADR 0008): trusted creators may self-resolve; untrusted creators must
      go through this service.

Implementation:

- [ ] Schema: `market_resolutions` (append-only verdicts) and
      `market_resolution_jobs` (leased queue), mirroring the review tables.
- [ ] Resolution service: provider-pluggable (heuristic/Ollama/Anthropic),
      evidence gathering via the hardened `safe-web` path (ADR 0011), prompt
      + structured output for outcome determination.
- [ ] Resolution runner: discovers markets past `resolutionTime` in status
      `graduated`, claims jobs, calls the service, persists verdicts.
- [ ] On-chain submission: `resolve`/`cancel` transactions with the same
      guarded-transition pattern the review runner uses.
- [ ] Operator override path (approve/reject/replace a pending verdict)
      behind the shared operator auth.
- [ ] Smoke test: seed a graduated market with known-outcome metadata, run
      one cycle, assert on-chain resolution and DB audit row.

## Exit Criteria

On the devchain, a graduated market whose `resolutionTime` has passed reaches
`resolved` (or `cancelled` for a draw) with a persisted, evidence-backed
verdict and no manual steps; an ambiguous market instead parks in manual
review and can be resolved by an operator action.

## Consequences

- An AI holding a resolver key is the highest-stakes automation in the
  system. The abstention threshold and operator delay window are the safety
  valves; both must be conservative defaults on testnet.
- Mirroring the review architecture doubles the runner/service processes the
  stack runs; local-dev orchestration and ADR 0015 must account for them.
