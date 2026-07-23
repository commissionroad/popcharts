---
type: summary
title: Repo ADR 0014 — Full-lifecycle E2E testing
description: Vertical ADR for an automated suite driving markets from creation to every terminal state through the real local stack, happy and unhappy paths; the acceptance gate for M1–M4 and the Arc launch; delivery re-homed 2026-07-15 into ADR 0017 Track C's nightly-lifecycle tier (service/chain layer for all paths + five UI journeys); all eight service/chain paths landed 2026-07-20/21 (ADR 0017 C3 complete); three of five UI journeys (C4 — golden, rejected creation, failed graduation) landed 2026-07-22, two open (partial clearing, cancelled/draw).
sources:
  - docs/adr/0014-full-lifecycle-e2e-testing.md
updated: 2026-07-22
---

# Repo ADR 0014: Full-Lifecycle E2E Testing

**Status: Accepted.** Dated 2026-07-06. Vertical checklist per ADR 0007
([summary](root-adr-0007-track-verticals-with-progress-adrs.md)).

## Context

Today's end-to-end proof is partial: `local:smoke` verifies market creation
through indexing to the API, one `@chain` Playwright spec verifies on-chain
market creation from the UI, and the AI review runner has its own smoke test.
No automated test drives a market through its complete lifespan, and the
unhappy branches (rejection, refunds, failed graduation, manual review) are
untested end to end. As verticals 0008–0013 land, cross-package regressions
are the main risk.

## Decision

Build a full-lifecycle E2E suite driving markets from creation to every
terminal state through the real local stack (chain, contracts, API, indexer,
AI services, app), covering happy and unhappy paths. The suite is the
acceptance gate for milestones M1–M4 and, ultimately, the Arc launch.

## Progress (all eight service/chain paths landed; UI journeys open)

Harness (**landed 2026-07-20**, ADR 0017 item C3 first slice):

- [x] `pnpm local:lifecycle-nightly` boots the full stack — chain, protocol
  deploy, Postgres, API, indexer, venue keeper, and the AI review +
  resolution service/runner pairs pinned to the heuristic provider — then
  hands it to a sequential scenario runner in `server/src/lifecycle-nightly/`
  (forward-only chain-time jumps; every scenario leaves its markets
  terminal; assertions market-scoped so dirty local state can't affect
  verdicts).
- [x] Scenario utilities: known-verdict metadata markers, deterministic
  balanced receipt placement (the interactive trading bot stays a manual
  tool), and a money paper-trail assertion module reconciling chain logs ↔
  event tables both ways with per-receipt retained+refund=cost identities.

Happy path (**landed 2026-07-20**):

- [x] Lifecycle spec: create (injected wallet at the service layer) →
  AI approve → receipt trading → graduation threshold → clearing → postgrad
  trading → resolution → redemption; asserting API, database, and on-chain state at
  each transition — review, graduation/clearing, and resolution all through
  the real runner/keeper services, no dev force endpoints.

Unhappy paths (all six **landed 2026-07-21**):

- [x] AI rejection: heuristic hard flag → real runner rejects on-chain →
  rejection reasons served on the market API (`aiReview` payload); receipts
  refused (terminal).
- [x] Manual review: retrospective soft flag parks the market — the
  manual_review verdict transitions nothing; the operator approves with the
  review-manager key (the admin API endpoint only re-queues AI reviews, it
  cannot decide) and the market proceeds to bootstrap.
- [x] Failed graduation: below-threshold receipts + deadline jump → the
  keeper's sweep opens refunds (`markRefundable`); both owners claim full
  cost back on-chain; double-claim rejected.
- [x] Partial clearing: a balanced book to the threshold plus a one-sided
  YES excess makes YES the crowded side; band-pass clearing prorates the
  excess to refund while the matched cap still graduates, so
  graduated-receipt claims carry a genuine mix of fully-retained (refund 0)
  and refunded (refund > 0) rows with `retainedCost + refund == cost` each.
  `RefundedReceiptClaimed` is a different (no-match) lifecycle — failed
  graduation covers it. The keeper is paused during book assembly (its live
  ReceiptPlaced watcher would graduate the balanced book before the excess).
- [x] Draw resolution: the runner records the heuristic draw verdict and
  deliberately parks it (`cancel_draw` maps to no chain action — draws are
  always a human call); the operator cancels with the resolver key; both
  legs redeem at half value via `redeemCancelled`.
- [x] Infrastructure failure drills: the indexer restart drill stops the
  indexer, emits receipt events while it is down, restarts it, and asserts
  the cursor sweep backfills the missed events; the AI-outage drill stops
  the review service, watches the runner record a backed-off failed attempt,
  restarts it, and asserts the market recovers to bootstrap on its own
  (keyed off market status, never the job's transient terminal_failed).
  Both bounce services through a stack control server the orchestrator
  exposes — the scenario never owns process lifecycles.

UI journeys (five full-E2E Playwright `@lifecycle` paths, injected wallet, no
auth-vendor login; ADR 0017 item C4 — the user-visible money-out moment, not
the paper trail):

- [x] Golden journey (**landed 2026-07-22**, `app/src/tests/e2e/golden-journey.spec.ts`):
  UI create → review approval → pregrad receipt → graduation → postgrad trade
  → resolution → redeem winnings, asserting the rendered claim and a risen
  balance. The review verdict is forced deterministically through a dev review
  endpoint (review is a controlled test input, not an AI dependency);
  graduation and resolution use the local dev endpoints too.
- [x] Rejected creation (**landed 2026-07-22**, `rejected-creation.spec.ts`):
  the dev review endpoint forces a `reject` verdict with a known reason; the
  market page renders the rejected status and that reason in the AI review card.
- [x] Failed graduation (**landed 2026-07-22**, `failed-graduation.spec.ts`):
  a single unmatched YES receipt keeps the market sub-threshold; the dev close
  opens refunds via `markRefundable` and the holder claims the full cost back
  on the market page.
- [ ] Partial clearing: retained + refunded itemized in the claim flow.
- [ ] Cancelled/draw: redeem at cost through the ADR 0018 surface (an
  `@lifecycle` draw test already exists; C4 finalizes it as journey 5).

Gated variants:

- [ ] Opt-in smoke running review (later resolution) against the real
  Anthropic provider, kept out of default CI for cost.

## Exit criteria

One command runs the full suite green on a fresh checkout. Every terminal
market status (`rejected`, `refunded`, `resolved`, cancelled/draw) is reached
by at least one spec, and every user-visible claim/redemption flow is
exercised through the real UI.

## Consequences

The suite depends on nearly every other vertical — build incrementally; each
vertical PR should extend the lifecycle spec rather than deferring testing.
Full-stack Playwright runs are slow: keep default CI at the smoke tier and run
the lifecycle suite on a schedule or pre-merge label until timings are known.

## Related pages

- [../concepts/testing-strategy.md](../concepts/testing-strategy.md)
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md)
- [../concepts/graduation-clearing.md](../concepts/graduation-clearing.md)
- [../entities/devchain.md](../entities/devchain.md)
- [../entities/indexer.md](../entities/indexer.md)
- [../entities/ai-review-service.md](../entities/ai-review-service.md)
- [../entities/app-workspace.md](../entities/app-workspace.md)
