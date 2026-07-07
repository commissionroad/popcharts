---
type: summary
title: Repo ADR 0011 — AI review service hardening
description: Vertical ADR to harden the working AI review loop for unattended operation — operator auth, safe evidence fetching, strict output validation, prompt-version policy, metrics; all eight items open.
sources:
  - docs/adr/0011-ai-review-service-hardening.md
updated: 2026-07-07
---

# Repo ADR 0011: AI Review Service Hardening

**Status: Accepted.** Dated 2026-07-06. Vertical checklist per ADR 0007
([summary](root-adr-0007-track-verticals-with-progress-adrs.md)).

## Context

AI review gatekeeping works end to end locally: the runner claims leased jobs
from Postgres, calls the stateless review service, persists an append-only
audit row, and transitions the market on-chain via
`approveMarket`/`rejectMarket`. Three providers are pluggable (heuristic,
Ollama, Anthropic with native web search/fetch), retries use exponential
backoff, and a smoke test covers the loop. Design docs:
`docs/ai-review-runner-design.md`, `docs/ai-review-next-phase.md`.

Remaining gaps are hardening, not architecture: env-flag-gated manual-review
override, evidence fetching that doesn't block private IPs or bound redirects,
manual prompt-version bumps with no re-review policy, minimal model-output
validation, logs but no metrics.

## Decision

Harden the existing review service and runner for unattended operation against
Arc Testnet. The service keeps its single-call review shape (multi-turn
research stays deferred). Deployment is ADR 0015.

## Progress (all items unchecked as of 2026-07-07)

Security:

- [ ] Operator authentication on the manual re-review path, shared with the
  API admin auth (ADR 0009).
- [ ] Evidence fetching hardening in `safe-web.ts`: block private/loopback
  IPs, cap redirects, validate content types, bound response sizes.
- [ ] Review-manager key handling documented: the key signing
  `approveMarket`/`rejectMarket` is loaded from configuration, never logged,
  rotatable without schema changes.

Robustness:

- [ ] Strict model-output validation with a defined fallback verdict
  (`manual_review`) on malformed responses.
- [ ] Decide and implement the prompt-version policy: what happens to
  already-reviewed and in-flight markets when `AI_REVIEW_PROMPT_VERSION`
  changes.
- [ ] Stuck-job recovery: expired leases reclaimed; a terminal-failure path
  notifies operators (surfaced in the admin API).

Observability:

- [ ] Emit metrics from service and runner: review latency, verdict
  distribution, provider errors, retry counts, queue depth (dashboards and
  alarms belong to ADR 0015).

Product feedback:

- [ ] Rejection reasons servable to the app in a user-appropriate form
  (distinct from the full audit record), so creators learn why a market was
  rejected (consumed by ADR 0013).

## Exit criteria

Review service and runner run unattended for a week of bot-generated market
submissions (mixed approvable, rejectable, malformed) with every market
reaching a terminal review state, no stuck jobs, and no privileged action
possible without operator auth.

## Consequences

Sharing operator auth couples this ADR to ADR 0009 — land the auth mechanism
once, in the server package, and consume it here. Hardened evidence fetching
may reject sources that previously passed; verdicts can shift between prompt
versions, which is why the version is persisted per review.

## Related pages

- [../entities/ai-review-service.md](../entities/ai-review-service.md)
- [../entities/server-workspace.md](../entities/server-workspace.md)
- [../entities/pregrad-manager.md](../entities/pregrad-manager.md)
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md)
- [../concepts/ai-assisted-resolution.md](../concepts/ai-assisted-resolution.md)
