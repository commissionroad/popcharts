---
type: summary
title: Repo ADR 0018 — Terminal-market surface and redemption UX
description: Give resolved and postgrad-cancelled markets a first-class surface — API keeps the postgrad payload for any finalized-graduation market, outcome banners, wallet-signed redeem/redeemCancelled panels, portfolio terminal states, e2e coverage; closes ADR 0013's open redemption checkbox for postgrad states.
sources:
  - docs/adr/0018-terminal-market-surface-and-redemption-ux.md
updated: 2026-07-14
---

# Repo ADR 0018: Terminal-Market Surface and Redemption UX

**Status: Accepted.** Dated 2026-07-14. Checklist ADR born from the
2026-07-14 orchestrated full-lifecycle test session; all six slices done
(PRs #219/#234, the slice-1 API PR #256, and the lifecycle e2e lane) — the
ADR is complete.

## Context

The app effectively abandons a market the moment it leaves `graduated`:

- **Resolved markets regress to the pre-graduation layout** — locked receipt
  ticket, a misleading "READY TO GRADUATE" stat, the pre-grad LMSR chart;
  every postgrad panel (venue handoff, order book, position, trade ticket)
  disappears.
- **The winning side is displayed nowhere.** A RESOLVED badge shows, but
  never YES or NO — even though the indexer has it
  (`postgrad_resolution_events.winning_side`).
- **No redemption UX** (the open "Redemption/claims UX" checkbox in
  [root ADR 0013](root-adr-0013-app-feature-completion.md)). The test
  session's wallet held 250 winning YES tokens with no way to collect in the
  app; the contract path `redeem(side, amount)` pays 1:1 (script-verified).
- **Cancelled postgrad markets are worse: the API drops the entire
  `postgrad` payload** once `markets.status = 'cancelled'` (`getMarketById`
  includes it only for `graduated`/`resolved`), so the app can't even
  discover the child-market address to build the
  `redeemCancelled(yesAmount, noAmount)` 50c-per-token flow
  (script-verified). Pregrad cancels/refunds are fine (receipt-refund claims
  shipped in PRs #192/#193); the gap is specifically postgrad terminal states.
- Portfolio shares the blind spot: backed positions on resolved markets
  still render "at 54c" as if tradable.

The money paper trail already exists at the indexer level
(`postgrad_resolution_events`, outcome-token transfer watchers) — this is
surface + API-read work, not new event plumbing.

## Decision

Every postgrad terminal state (`resolved`, postgrad `cancelled`) gets a
first-class market surface: keep the postgrad panels, show the outcome, and
offer wallet-signed redemption. **The API returns the `postgrad` payload for
any market that graduated, regardless of subsequent status** — terminal
status must never erase venue data the app needs for redemption. Trading
affordances (ticket, order book) are replaced by a redemption panel; history
(price chart, review rubric) stays. Redemption follows the existing
wallet-signed client pattern (injected viem clients like
`refund-claim-service.ts`), not new API endpoints — the deployed API stays
read-only ([root ADR 0009](root-adr-0009-server-api-hardening.md)).

## Implementation slices (all done; each its own PR)

- [x] **API** (PR #219 + slice-1 PR): resolution outcome (`winningSide`,
      timestamps, tx hash) exposed on market reads; `postgrad` block kept
      for cancelled markets with route tests over all three statuses.
- [x] **Resolved market surface** (PR #219): outcome summary, pre-grad
      price history kept, graduation bar and pre-grad affordances removed
      for settled states. Venue price history on terminal pages remains a
      follow-up.
- [x] **Redemption panel (resolved)** (PR #219 `claim-winnings-panel` +
      `resolution-actions`): redeem flow with losing-side/nothing-to-claim
      states and a resting-ask callout beside the open-orders cancel
      surface.
- [x] **Cancelled (draw) surface + `redeemCancelled` panel** (PR #219):
      draw banner distinguishing postgrad draws from pregrad admin-cancels;
      both-side 50c redemption.
- [x] **Portfolio terminal position states** (PR #234): redemption payout
      rows (won/draw kinds) via the `portfolioRedemption` API model.
- [x] **E2E**: `@lifecycle` Playwright lane (`pnpm lifecycle:e2e`) — full
      stack via `local:smoke --keep-running --fresh-db`, app-driven
      create→graduate→resolve/cancel, browser redemption of both terminal
      states with on-chain balance assertions; nightly `terminal-e2e` job.

## Exit criteria

A holder of winning (or draw-cancelled) tokens can discover the outcome and
collect collateral entirely through the app; a market page never shows
pre-graduation affordances or "ready to graduate" copy past graduation.

## Consequences

- The market API's `postgrad` block becomes part of the read contract for
  all post-graduation statuses.
- The market-surface switch gains two more modes (resolved, cancelled);
  fixtures and route tests must cover them so they don't silently regress to
  the pre-grad fallback.
- Draw cancellation stops being operator-only plumbing: `cancel_draw`
  verdicts (which park for a manual operator `cancel()` per
  [root ADR 0012](root-adr-0012-ai-assisted-resolution.md)) become
  user-visible, increasing pressure to finish operator tooling for
  per-market children (the current `hardhat operator cancel-market` task
  only targets the synthetic manifest market).

## Related pages

- [../entities/app-workspace.md](../entities/app-workspace.md)
- [../entities/postgrad-market.md](../entities/postgrad-market.md)
- [../entities/server-workspace.md](../entities/server-workspace.md)
- [../entities/indexer.md](../entities/indexer.md)
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md)
- [root ADR 0013](root-adr-0013-app-feature-completion.md) — parent checkbox this executes
