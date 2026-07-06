# ADR 0011: AI Review Service Hardening

Status: Accepted

Date: 2026-07-06

## Context

AI review gatekeeping works end to end locally: the runner claims leased jobs
from Postgres, calls the stateless review service, persists an append-only
audit row, and transitions the market on-chain via
`approveMarket`/`rejectMarket`. Three providers are pluggable (heuristic,
Ollama, Anthropic with native web search/fetch), retries use exponential
backoff, and a smoke test covers the loop. See
`docs/ai-review-runner-design.md` and `docs/ai-review-next-phase.md`.

Remaining gaps are hardening, not architecture: the manual-review override is
gated by an env flag instead of operator auth, evidence fetching does not
block private IPs or bound redirects, prompt-version bumps are manual with no
re-review policy, model output parsing has minimal validation, and the
service emits logs but no metrics.

## Decision

Harden the existing review service and runner for unattended operation
against Arc Testnet. The service keeps its single-call review shape
(multi-turn research stays deferred). Deployment is ADR 0015.

## Progress

Security:

- [ ] Operator authentication on the manual re-review path, shared with the
      API admin auth (ADR 0009).
- [ ] Evidence fetching hardening in `safe-web.ts`: block private/loopback
      IPs, cap redirects, validate content types, bound response sizes.
- [ ] Review-manager key handling documented: the key that signs
      `approveMarket`/`rejectMarket` is loaded from configuration, never
      logged, and rotatable without schema changes.

Robustness:

- [ ] Strict model-output validation with a defined fallback verdict
      (`manual_review`) on malformed responses.
- [ ] Decide and implement the prompt-version policy: what happens to
      already-reviewed and in-flight markets when
      `AI_REVIEW_PROMPT_VERSION` changes.
- [ ] Stuck-job recovery: expired leases are reclaimed and a terminal-failure
      path notifies operators (surface in the admin API).

Observability:

- [ ] Emit metrics from service and runner: review latency, verdict
      distribution, provider errors, retry counts, queue depth. (Dashboards
      and alarms belong to ADR 0015.)

Product feedback:

- [ ] Rejection reasons are servable to the app in a user-appropriate form
      (distinct from the full audit record), so creators learn why a market
      was rejected (consumed by ADR 0013).

## Exit Criteria

The review service and runner can run unattended for a week of bot-generated
market submissions (mixed approvable, rejectable, and malformed) with every
market reaching a terminal review state, no stuck jobs, and no privileged
action possible without operator auth.

## Consequences

- Sharing operator auth with the API couples this ADR to ADR 0009; land the
  auth mechanism once, in the server package, and consume it here.
- Hardened evidence fetching may reject sources that previously passed;
  verdicts can shift between prompt versions, which is why the version is
  persisted per review.
