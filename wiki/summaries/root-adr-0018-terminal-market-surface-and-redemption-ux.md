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
2026-07-14 orchestrated full-lifecycle test session; all six slices open.

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

## Implementation slices (all open; each its own PR)

- [ ] **API**: include `postgrad` for any market with a
      `graduation_finalized_events` row and expose the resolution outcome
      (`winningSide`, timestamps, tx hash) from `postgrad_resolution_events`;
      route/service tests over all three statuses.
- [ ] **Resolved market surface**: postgrad layout kept, outcome banner
      (YES/NO won, when, tx), price history + review rubric stay, redemption
      panel replaces tickets, "READY TO GRADUATE" stat removed for terminal
      markets.
- [ ] **Redemption panel (resolved)**: wallet-signed
      `redeem(winningSide, amount)` with balance display, approve+redeem
      flow, nothing-to-redeem / losing-side / redeemed states; contract
      service + unit tests mirroring `refund-claim-service.ts`.
- [ ] **Cancelled (draw) surface + `redeemCancelled` panel**: draw banner;
      both sides at 50c per token, defaulting to full wallet balances.
- [ ] **Portfolio terminal position states**: won/lost/draw + redeemable
      value (winning × $1, any-side × $0.50, losing = $0) instead of last
      pool price, linking to the redemption panel.
- [ ] **E2E**: extend the chain e2e lane to walk resolve → redeem and
      cancel → redeemCancelled with the test-wallet fixture.

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
