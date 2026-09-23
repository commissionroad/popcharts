# ADR 0011: AI Review Service Hardening

Status: Accepted — the review *service* hardening stands; the on-chain review
*path* described in Context was retired by [ADR 0022](0022-review-first-market-creation.md)
P5 on 2026-08-04. Read the Context section as a description of 2026-07-06, not
of today: there is no review runner process, no `approveMarket` / `rejectMarket`
transition, and no `market_ai_review_jobs` queue. Review now runs off-chain
against drafts (`server/src/draft-review/`), still through the same stateless
service this ADR hardens.

Date: 2026-07-06

## Context

AI review gatekeeping works end to end locally: the runner claims leased jobs
from Postgres, calls the stateless review service, persists an append-only
audit row, and transitions the market on-chain via
`approveMarket`/`rejectMarket`. Three providers are pluggable (heuristic,
Ollama, Anthropic with native web search/fetch), retries use exponential
backoff, and a smoke test covers the loop. See
`docs/ai-review-runner-design.md` and `docs/ai-review-next-phase.md`.

Remaining gaps are hardening, not architecture: evidence fetching does not
block private IPs or bound redirects, prompt-version bumps are manual with no
re-review policy, model output parsing has minimal validation, and the
service emits logs but no metrics. The manual re-review path is an operator
action; it is a dev-only API endpoint today and does not belong in the
production API at all (see ADR 0009) — the fix is to keep it out of production
builds, not to authenticate it.

## Decision

Harden the existing review service and runner for unattended operation
against Arc Testnet. The service keeps its single-call review shape
(multi-turn research stays deferred). Deployment is ADR 0015.

## Progress

Security:

- [ ] Manual re-review is an operator action: perform it locally against the
      chain and job queue (a local admin panel with the operator keys), and
      exclude the `/admin/*` re-review endpoint from production builds (ADR
      0009). It is not an authenticated API surface.
- [x] Evidence fetching hardening in `safe-web.ts`: block private/loopback
      IPs, cap redirects, validate content types, bound response sizes.
- [x] Review-manager key handling documented: the key that signs
      `approveMarket`/`rejectMarket` is loaded from configuration, never
      logged, and rotatable without schema changes.

Robustness:

- [x] Strict model-output validation with a defined fallback verdict
      (`manual_review`) on malformed responses.
- [ ] Decide and implement the prompt-version policy: what happens to
      already-reviewed and in-flight markets when
      `AI_REVIEW_PROMPT_VERSION` changes. *(Now owned by ADR 0019's
      prompt-version box and executed through ADR 0027's loop. The version is
      recorded on every verdict row and on every `POPCHARTS_VERDICT_RUN`
      record; what is missing is the written policy, not the plumbing.)*
- [ ] Stuck-job recovery: expired leases are reclaimed and a terminal-failure
      path notifies operators (surface in the local admin panel, not the
      deployed API). *(Partial: lease fencing and reclaim are implemented on
      the resolution side — `ai-resolution-runner/jobs.ts` and `failures.ts`
      treat a lost fence as `lease_lost` rather than overwriting another
      runner's row — and `shared/operator-alert-log.ts` is the notification
      channel. The review runner's equivalent, and a terminal-failure alert
      tag for either runner, are still open.)*
- [x] Transient provider failures remain retryable jobs instead of becoming
      completed heuristic approvals. The local model gets a five-minute
      bounded call budget with runner timeout and lease margins above it.

Observability:

- [ ] Emit metrics from service and runner: review latency, verdict
      distribution, provider errors, retry counts, queue depth. (Dashboards
      and alarms belong to ADR 0015.) *(Partial, delivered by ADR 0027 A3 in
      #538: `shared/verdict-run-log.ts` emits one `POPCHARTS_VERDICT_RUN`
      record per run of both services carrying latency, outcome, ok/error,
      provider, model, prompt version and token/cost accounting, and
      `server/scripts/verdict-run-aggregate.ts` turns a captured log into
      per-provider aggregates. Retry counts and queue depth are not emitted.)*

Product feedback:

- [x] Rejection reasons are servable to the app in a user-appropriate form
      (distinct from the full audit record), so creators learn why a market
      was rejected (consumed by ADR 0013). *(Reshaped by ADR 0022: review now
      runs on drafts before anything reaches the chain, so the surface is
      draft-level. `draft-review/feedback.ts` maps each hard flag to
      creator-facing `issue`/`howToFix` copy — deliberately hand-written, not
      model-generated — persisted as `DraftReviewFeedback` on
      `market_draft_reviews` and rendered by the creator studio's draft card
      and the create flow's review progress panel.)*
- [x] Market reads expose sanitized review progress; the detail page shows and
      refreshes a pending state until an immutable review exists, and completed
      scorecards include one persisted rationale per metric.

## Exit Criteria

The review service and runner can run unattended for a week of bot-generated
market submissions (mixed approvable, rejectable, and malformed) with every
market reaching a terminal review state and no stuck jobs. No operator action
(including manual re-review) is reachable through the deployed API; operators
act locally against the chain and job queue.

## Consequences

- Manual re-review lives in the local admin panel, not the API, so this ADR no
  longer couples to a shared API auth mechanism (ADR 0009). The re-review
  `/admin/*` endpoint stays a dev-only tool, excluded from production builds.
- Hardened evidence fetching may reject sources that previously passed;
  verdicts can shift between prompt versions, which is why the version is
  persisted per review.
- Provider latency is not a review verdict. Retryable failures leave the market
  under review without a scorecard; terminal failures surface as delayed work
  requiring attention. Explicit heuristic reviews remain available for smoke
  tests and deterministic policy checks.
