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

Delivery and layering (amended by the 2026-07-15 ADR 0017 Track C grill):
the suite lands as the `nightly-lifecycle` tier of ADR 0017 Track C, and
the checklist below ticks in the same PRs as that work. Two layers: every
path runs at the **service/chain layer** (scripts drive the devchain;
assertions hit the API and database, ending with the money paper trail
balancing), and **five paths additionally run as full UI journeys**
(Playwright, injected wallet — auth-vendor login stays out of nightly).
UI-level assertions for the remaining paths are deliberately not built:
the app's enforced-100% unit tier plus those five journeys carry the UI's
regression risk.

## Progress

Harness:

- [x] Extend the local-dev orchestration so a single command boots the full
      stack — including the clearing keeper (ADR 0008) and resolution
      runner (ADR 0012) — with deterministic accounts and time control
      (devchain time-travel for `graduationTime`/`resolutionTime`).
      (`pnpm local:lifecycle-nightly`; scenarios in
      `server/src/lifecycle-nightly/`, run sequentially with forward-only
      chain-time jumps and market-scoped assertions.)
- [x] Scenario utilities: seed markets with known-verdict metadata
      (heuristic provider makes review and resolution deterministic), drive
      receipt volume with deterministic balanced buys through the trading
      bot's receipt mechanics (the interactive bot itself stays a manual
      dev tool — nightly scenarios need exact matched volume, not random
      flow). Every scenario ends with a market-scoped money paper-trail
      assertion (`lifecycle-nightly/paper-trail.ts`): chain logs ↔ event
      tables reconciled in both directions, per-receipt
      retained + refund = cost identities, and postgrad collateral
      conservation.

Happy path:

- [x] Lifecycle spec: create (injected wallet at the service layer) →
      AI approve → receipt trading → graduation threshold reached →
      clearing → postgrad trading → resolution → redemption; asserting
      API, database, and on-chain state at each transition.
      (`scenarios/happy-path.ts` — review approval, graduation/clearing,
      and resolution all ride the real runner/keeper services, no dev
      force endpoints.)

UI journeys (the five full-E2E paths, Playwright `@lifecycle`):

- [ ] Golden journey: UI create → approval → pregrad trade → graduation →
      postgrad trade → resolution → redeem winnings, asserting the
      user-visible balances.
- [ ] Rejected creation: creator sees `rejected` with reasons.
- [ ] Failed graduation: full refund claimed through the UI.
- [ ] Partial clearing: retained + refunded portions itemized in the UI
      claim flow.
- [ ] Cancelled/draw: redeem at cost through the ADR 0018 redemption
      surface.

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
