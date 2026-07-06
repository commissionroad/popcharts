# ADR 0014: Full-Lifecycle E2E Testing

Status: Accepted

Date: 2026-07-06

## Context

Today's end-to-end proof is partial: `local:smoke` verifies market creation
through indexing to the API, one `@chain` Playwright spec verifies on-chain
market creation from the UI, and the AI review runner has its own smoke test.
No automated test drives a market through its complete lifespan, and the
unhappy branches (rejection, refunds, failed graduation, manual review) are
untested end to end. As verticals 0008–0013 land, regressions across package
boundaries are the main risk.

## Decision

Build a full-lifecycle E2E suite that drives markets from creation to every
terminal state through the real local stack (chain, contracts, API, indexer,
AI services, app), covering happy and unhappy paths. The suite is the
acceptance gate for milestones M1–M4 and, ultimately, the Arc launch.

## Progress

Harness:

- [ ] Extend the local-dev orchestration so a single command boots the full
      stack — including the clearing keeper (ADR 0008) and resolution
      runner (ADR 0012) — with deterministic accounts and time control
      (devchain time-travel for `graduationTime`/`resolutionTime`).
- [ ] Scenario utilities: seed markets with known-verdict metadata
      (heuristic provider makes review and resolution deterministic), drive
      receipt volume via the existing trading bot.

Happy path:

- [ ] Lifecycle spec: create (Google/Privy test login or injected wallet) →
      AI approve → receipt trading → graduation threshold reached →
      clearing → postgrad trading → resolution → redemption; asserting UI,
      API, and on-chain state at each transition.

Unhappy paths:

- [ ] AI rejection: policy-violating market → `rejected` → creator sees
      rejection reasons.
- [ ] Manual review: ambiguous market parks in `under_review` → operator
      approves via admin path → proceeds.
- [ ] Failed graduation: insufficient matched liquidity → refunds available
      → user claims refund.
- [ ] Partial clearing: some bands match, some refund; both claim paths
      verified against escrow accounting.
- [ ] Draw resolution: `cancel()` path with both sides redeeming at cost.
- [ ] Infrastructure failure drills: indexer restart mid-lifecycle and AI
      service outage with runner retries — lifecycle still completes.

Gated variants:

- [ ] An opt-in smoke that runs review (and later resolution) against the
      real Anthropic provider, kept out of default CI for cost.

## Exit Criteria

One command runs the full suite green on a fresh checkout. Every terminal
market status (`rejected`, `refunded`, `resolved`, cancelled/draw) is reached
by at least one spec, and every user-visible claim/redemption flow is
exercised through the real UI.

## Consequences

- The suite depends on nearly every other vertical; build it incrementally —
  each vertical PR should extend the lifecycle spec rather than leaving
  testing for the end.
- Full-stack Playwright runs are slow; keep the default CI gate at the smoke
  tier and run the lifecycle suite on a schedule or pre-merge label until
  timings are known.
