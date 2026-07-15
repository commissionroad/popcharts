---
type: summary
title: Repo ADR 0011 — AI review service hardening
description: Vertical ADR to harden the working AI review loop for unattended operation — safe evidence fetching, strict output validation, prompt-version policy, metrics, stuck-job recovery. Manual re-review is a local operator action, not an authenticated API endpoint.
sources:
  - docs/adr/0011-ai-review-service-hardening.md
updated: 2026-07-14
---

# Repo ADR 0011: AI Review Service Hardening

**Status: Accepted.** Dated 2026-07-06. Vertical checklist per ADR 0007
([summary](root-adr-0007-track-verticals-with-progress-adrs.md)).

> **Extended by [root ADR 0019](root-adr-0019-ai-verdict-quality-program.md)**
> (2026-07-14): this ADR hardens the *pipeline*; 0019 measures the *verdicts*
> (eval harness, labeled dataset, reject-corroboration policy). 0019 carries
> the open prompt-version checkbox below (bump requires a recorded eval run)
> and gives the open metrics item its consumer (verdict-distribution trends).

## Context

AI review gatekeeping works end to end locally: the runner claims leased jobs
from Postgres, calls the stateless review service, persists an append-only
audit row, and transitions the market on-chain via
`approveMarket`/`rejectMarket`. Three providers are pluggable (heuristic,
Ollama, Anthropic with native web search/fetch), retries use exponential
backoff, and a smoke test covers the loop. Design docs:
`docs/ai-review-runner-design.md`, `docs/ai-review-next-phase.md`.

Remaining gaps are hardening, not architecture: evidence fetching that doesn't
block private IPs or bound redirects, manual prompt-version bumps with no
re-review policy, minimal model-output validation, logs but no metrics. The
manual re-review path is an operator action — a dev-only API endpoint today
that does not belong in the production API at all (ADR 0009); the fix is to
keep it out of production builds, not to authenticate it.

## Decision

Harden the existing review service and runner for unattended operation against
Arc Testnet. The service keeps its single-call review shape (multi-turn
research stays deferred). Deployment is ADR 0015.

## Progress (5 of 10 done as of 2026-07-14)

Security:

- [ ] Manual re-review is an operator action: run it locally against the chain
      and job queue (a keyed admin panel), and exclude the `/admin/*` re-review
      endpoint from production builds (ADR 0009). Not an authenticated API surface.
- [x] Evidence fetching hardening in `safe-web.ts`: block private/loopback
      IPs, cap redirects, validate content types, bound response sizes.
- [x] Review-manager key handling documented: the key signing
      `approveMarket`/`rejectMarket` is loaded from configuration, never logged,
      rotatable without schema changes.

Robustness:

- [x] Strict model-output validation with a defined fallback verdict
      (`manual_review`) on malformed responses.
- [ ] Decide and implement the prompt-version policy: what happens to
      already-reviewed and in-flight markets when `AI_REVIEW_PROMPT_VERSION`
      changes.
- [ ] Stuck-job recovery: expired leases reclaimed; a terminal-failure path
      notifies operators (surfaced in the local admin panel, not the deployed API).
- [x] Transient provider failures stay retryable instead of becoming completed
      heuristic approvals; local timeouts and leases are aligned around a bounded
      five-minute model budget.

Observability:

- [ ] Emit metrics from service and runner: review latency, verdict
      distribution, provider errors, retry counts, queue depth (dashboards and
      alarms belong to ADR 0015).

Product feedback:

- [ ] Rejection reasons servable to the app in a user-appropriate form
      (distinct from the full audit record), so creators learn why a market was
      rejected (consumed by ADR 0013).
- [x] Public reads expose sanitized pending/complete/attention states, the
      detail page refreshes pending reviews, and every completed metric stores a
      rationale.

## Exit criteria

Review service and runner run unattended for a week of bot-generated market
submissions (mixed approvable, rejectable, malformed) with every market
reaching a terminal review state and no stuck jobs. No operator action
(including manual re-review) is reachable through the deployed API; operators
act locally against the chain and job queue.

## Consequences

Manual re-review lives in the local admin panel, not the API — so this ADR no
longer couples to a shared API auth mechanism. Hardened evidence fetching may
reject sources that previously passed; verdicts can shift between prompt
versions, which is why the version is persisted per review.

Provider latency is not a verdict: retryable failures leave the market locked
without a scorecard, while exhausted retries surface as delayed work needing
attention. Explicit heuristic runs remain available for deterministic smoke.

## Related pages

- [../entities/ai-review-service.md](../entities/ai-review-service.md)
- [../entities/server-workspace.md](../entities/server-workspace.md)
- [../entities/pregrad-manager.md](../entities/pregrad-manager.md)
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md)
- [../concepts/ai-assisted-resolution.md](../concepts/ai-assisted-resolution.md)
