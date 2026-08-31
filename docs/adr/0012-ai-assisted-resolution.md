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

- [x] Verdict contract: outcome (yes/no/draw), confidence, evidence,
      abstention threshold below which resolution goes to manual review.
      *(`ai-resolution/types.ts` + `result-schema.ts`; the threshold is
      `RESOLUTION_ABSTENTION_THRESHOLD` with a shared
      `DEFAULT_ABSTENTION_THRESHOLD`, and `auto-resolvable.ts` holds the single
      definition of the auto-resolve rule that both `deriveVerdict()` in the
      service and the runner's pre-signing re-check call (#546).)*
- [x] Dispute story for testnet — superseded by ADR 0024, which replaces the
      off-chain delay window with an on-chain dispute window: `resolve`
      proposes, a bonded `dispute` freezes the market, and an operator
      settles. See ADR 0024 for the mechanism and its phases.
- [ ] Resolver key custody and its relationship to the review-manager key.
      *(Partial: the keys are already separate —
      `POPCHARTS_RESOLVER_PRIVATE_KEY` in
      `ai-resolution-runner/chain-resolution.ts`, distinct from the
      review-manager key, with a local-devchain default only when the network
      is `local`. What is still owed is the written custody and rotation story;
      secret provisioning for a deployed environment is ADR 0015.)*
- [ ] Interaction with `bypassAiResolution` (semantics finalized in
      ADR 0008): trusted creators may self-resolve; untrusted creators must
      go through this service. *(Still open, and the anchor is concrete: the
      flag is decoded and stored by `indexer/handlers/market-created.ts`, but
      it does not appear in the enqueue predicate in
      `ai-resolution-runner/queries.ts`, so a bypass market is queued like any
      other. Paired with ADR 0008's matching box.)*

Implementation:

- [x] Schema: `market_resolutions` (append-only verdicts) and
      `market_resolution_jobs` (leased queue), mirroring the review tables.
      *(`db/schema/market-resolutions.ts` and
      `db/schema/market-resolution-jobs.ts`; ADR 0026 added the `pending` /
      `confirmed` commit state that makes the intent durable.)*
- [x] Resolution service: provider-pluggable (heuristic/Ollama/Anthropic),
      evidence gathering via the hardened `safe-web` path (ADR 0011), prompt
      + structured output for outcome determination.
      *(`server/src/ai-resolution/` — `providers/registry.ts` over heuristic,
      Ollama, headless-CLI and Messages-API providers; `evidence.ts`;
      `resolution-parsing.ts`; `policy.ts`.)*
- [x] Resolution runner: discovers markets past `resolutionTime` in status
      `graduated`, claims jobs, calls the service, persists verdicts.
      *(`server/src/ai-resolution-runner/` — `queries.ts` claim predicate,
      `jobs.ts` lease-fenced attempt loop, `client.ts` schema-validated service
      call, `corroboration.ts`, `pending-status.ts`.)*
- [x] On-chain submission: `resolve`/`cancel` transactions with the same
      guarded-transition pattern the review runner uses. *(Superseded in shape
      by ADR 0024: the runner now submits `proposeResolution` in
      `ai-resolution-runner/chain-resolution.ts` and the keeper finalizes after
      the dispute window. #546 added a pre-signing re-check of the service
      response so an unsafe verdict cannot reach the key.)*
- [ ] Operator override (approve/reject/replace a pending verdict) as a
      local admin action against the chain and resolution job queue — a local
      admin panel holding the resolver key, never an authenticated API
      endpoint (see ADR 0009). The deployed API does not expose resolution
      overrides. *(Partial: force-resolve exists as a local dev-menu action
      (`app/src/features/market-detail/resolution-actions.ts`, reached from
      `features/dev-settings/dev-menu.tsx`), and the lifecycle harness holds
      resolver-keyed settle and cancel helpers in
      `server/src/lifecycle-nightly/operator.ts`. Approving, rejecting or
      replacing a *pending* verdict from the admin panel is still open, and
      ADR 0024's self-dispute + settle box is its sibling.)*
- [x] Smoke test: seed a graduated market with known-outcome metadata, run
      one cycle, assert on-chain resolution and DB audit row. *(Exceeded by the
      ADR 0014 lifecycle harness: `lifecycle-nightly/scenarios/happy-path.ts`
      drives the runner and asserts both the on-chain `winningSide` and the
      `market_resolutions` row, with `draw-cancel.ts`, `dispute-settlement.ts`
      and `dispute-window-finalize.ts` covering the other outcomes.)*

## Exit Criteria

On the devchain, a graduated market whose `resolutionTime` has passed reaches
`resolved` (or `cancelled` for a draw) with a persisted, evidence-backed
verdict and no manual steps; an ambiguous market instead parks in manual
review and can be resolved by a local operator action (a keyed admin panel
against the chain and job queue, not an API call).

## Consequences

- An AI holding a resolver key is the highest-stakes automation in the
  system. The abstention threshold and operator delay window are the safety
  valves; both must be conservative defaults on testnet.
- Mirroring the review architecture doubles the runner/service processes the
  stack runs; local-dev orchestration and ADR 0015 must account for them.
