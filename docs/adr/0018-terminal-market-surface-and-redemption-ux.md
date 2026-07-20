# ADR 0018: Terminal-Market Surface and Redemption UX

Status: Accepted

Date: 2026-07-14

## Context

The 2026-07-14 orchestrated full-lifecycle test session exercised every
market end state and found that the app effectively abandons a market the
moment it leaves `graduated`:

- **Resolved markets regress to the pre-graduation layout.** The market page
  renders the locked receipt ticket ("This receipt book is locked because the
  market is resolved"), a misleading "READY TO GRADUATE $2.5K/$2.5K matched"
  stat, and the pre-grad LMSR chart. The postgrad panels (venue handoff,
  order book, position, trade ticket) all disappear.
- **The winning side is not displayed anywhere.** A resolved market shows a
  RESOLVED badge but never says YES or NO won; the indexer has the answer
  (`postgrad_resolution_events.winning_side`) and the API already returns
  `status: resolved`.
- **There is no redemption UX** (the open "Redemption/claims UX" checkbox in
  ADR 0013). During the test session a connected wallet held 250 winning
  YES tokens on a resolved market with no way to collect in the app; the
  contract path (`redeem(side, amount)`) works and pays 1:1
  (script-verified).
- **Cancelled postgrad markets are worse: the API drops the entire
  `postgrad` payload** once `markets.status = 'cancelled'`
  (`getMarketById` includes it for `graduated`/`resolved` only), so the app
  cannot even discover the child-market address, outcome tokens, or pools of
  a draw-cancelled market. Holders are owed 50c per token via
  `redeemCancelled(yesAmount, noAmount)` (script-verified) and the app has
  no data to build that flow. Pregrad cancels/refunds are fine —
  receipt-refund claims shipped earlier (PRs #192/#193); this gap is
  specifically the postgrad terminal states.
- Portfolio has the same blind spot: a backed position on a resolved market
  still renders "at 54c" as if it were tradable, with no won/lost/redeemable
  state.

The money paper trail for redemption already exists at the indexer level
(`postgrad_resolution_events`, outcome-token transfer watchers), so this is
surface + API-read work, not new event plumbing.

## Decision

Give every postgrad terminal state (`resolved`, postgrad `cancelled`) a
first-class market surface: keep the postgrad panels, show the outcome, and
offer wallet-signed redemption. The API keeps returning the `postgrad`
payload for markets that graduated, regardless of the status they moved to
afterwards — terminal status must never erase venue data the app needs for
redemption. Trading affordances (ticket, order book) are replaced by a
redemption panel; history (price chart, review rubric) stays.

Redemption follows the existing wallet-signed client pattern (injected
viem clients like `refund-claim-service.ts`), not new API endpoints; the
deployed API stays read-only for these flows (ADR 0009).

## Implementation slices (each its own PR)

- [x] **API: stop dropping the postgrad payload on cancelled markets.**
      Resolution outcome (`winningSide`, timestamps, tx hash) exposed on
      market reads by PR #219; the `postgrad` block for cancelled markets
      restored with route tests over all three statuses in the slice-1 PR.
- [x] **Resolved market surface** (PR #219). Outcome summary with winning
      side and settlement time, pre-grad price history retained, graduation
      bar and pre-grad affordances removed for all settled states. Venue
      price history on terminal pages remains a nice-to-have follow-up.
- [x] **Redemption panel (resolved)** (PR #219 `claim-winnings-panel` +
      `resolution-actions`): balance display, redeem flow, losing-side and
      nothing-to-claim states, resting-ask callout with the open-orders
      cancel surface kept alongside.
- [x] **Cancelled (draw) market surface + `redeemCancelled` panel**
      (PR #219): draw banner distinguishing postgrad draws (resolution
      event) from pregrad admin-cancels (receipt refund view), both-side
      50c redemption.
- [x] **Portfolio: terminal position states** (PR #234): redemption payout
      rows on the portfolio with won/draw kinds, backed by the
      `portfolioRedemption` API model.
- [ ] **E2E coverage.** Extend the chain e2e lane to walk resolve → redeem
      and cancel → redeemCancelled with the test-wallet fixture (see the
      wallet-injection work from the same session) so the surfaces stay
      exercised.

## Exit criteria

A user who held winning tokens (or tokens on a draw-cancelled market) can
discover the outcome and collect their collateral entirely through the app,
and a market page never shows pre-graduation affordances or "ready to
graduate" copy for a market past graduation.

## Consequences

- The market API's `postgrad` block becomes part of the read contract for
  all post-graduation statuses; the app can rely on it for terminal states.
- The market-surface switch gains two more modes (resolved, cancelled); the
  fixture set and route tests must cover them so the modes don't regress to
  the pre-grad fallback silently.
- Draw cancellation stops being operator-only plumbing: once the surface
  exists, `cancel_draw` verdicts (which park for a manual operator `cancel()`
  per ADR 0012) become user-visible states, increasing pressure to finish
  the operator tooling for per-market children (the current
  `hardhat operator cancel-market` task only targets the synthetic
  manifest market).
