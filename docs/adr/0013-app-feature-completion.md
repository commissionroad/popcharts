# ADR 0013: App Feature Completion

Status: Accepted

Date: 2026-07-06

## Context

The pregrad journey in `app/` is polished: discovery, market detail with the
LMSR curve and AI review evidence, a full create flow with on-chain creation,
receipt placement with the ERC20 approve flow, and a receipts portfolio.
Privy is configured with `loginMethods: ["email", "google", "wallet"]`
(`src/integrations/wallet/wallet-config.ts`), and the market-detail graduate
button already calls a server action.

What is missing is everything after graduation — there is no postgrad
trading, positions, or redemption UI — plus the unhappy-path surfaces
(rejection feedback, refund claims), the graduation-page trigger, and a tail
of small product features.

## Decision

Complete the app across the full market lifecycle, consuming the API and
service surfaces from ADRs 0009–0012 as they land. Fixture fallback stays for
local development but every flow must work with fixtures disabled.

## Progress

Auth:

- [ ] Verify Google sign-in end to end against a real Privy app (config
      exists; needs dashboard enablement and a tested login → wallet →
      transaction path).
- [ ] Account/profile page: linked login methods, active wallet, disconnect.

Graduation:

- [x] Wire the graduation page's "Graduate market" button (the market-detail
      button already calls `graduateMarketAction`; both paths should share
      one flow with pending/success/error states reflecting chain state).
      *(`features/market-detail/graduate-market-button.tsx`, rendered by
      `market-detail-page.tsx`, over the shared `graduation-actions.ts` flow;
      it drives the public `POST /markets/:chainId/:marketId/graduate`
      failsafe from ADR 0009, and the clearing keeper graduates automatically
      without it.)*
- [x] Graduation outcome view driven by real clearing results (matched
      bands, refunds) once the clearing keeper (ADR 0008) emits them.
      *(`features/graduation-clearing/graduation-page.tsx` renders the
      matched/refunded split and the crossed price bands from indexed clearing
      results via `components/charts/band-strip`.)*

Postgrad trading:

- [x] Market detail switches to postgrad mode after graduation: YES/NO
      prices from the v4 venue, trade ticket for outcome tokens
      (approve/buy/sell against `BoundedPoolOrderManager`).
- [ ] Portfolio shows postgrad positions and P&L alongside pregrad receipts.
      *(Partial: the portfolio page carries Receipts, Backed positions, Open
      orders and Claimed payouts sections over `/portfolio`. P&L — cost
      basis, average entry, unrealised gain — is not computed anywhere in the
      app or the API, and remains the open half.)*
- [x] Redemption/claims UX: claim graduated receipts, redeem winning tokens
      after resolution, claim refunds on refunded markets. *(Delivered by ADR
      0018: `market-detail/claim-winnings-panel.tsx`,
      `integrations/contracts/redemption-service.ts` and
      `hooks/use-redemption.ts` for `redeem`/`redeemCancelled`, plus
      `portfolio/position-claim.tsx` — PRs #219 and #234.)*

Unhappy paths:

- [x] Rejected-market view showing user-appropriate AI rejection reasons
      (from ADR 0011) and what the creator can change before resubmitting.
      *(Reshaped by ADR 0022 — review happens on drafts before anything
      reaches the chain, so there is no rejected *market* to view. The surface
      is `features/creator-studio/draft-card.tsx` and the create flow's
      `draft-panels/review-progress-panel.tsx`, rendering the
      `issue`/`howToFix` feedback from `draft-review/feedback.ts`.)*
- [ ] Refund flows surfaced wherever a market lands in `refunded`/closed
      states, not only behind dev tools.
- [x] Receipt states communicate the full range of outcomes (matched,
      partially matched, refunded) after clearing.

Small features:

- [ ] Market search and richer category/status filtering against the API
      (ADR 0009), replacing client-side-only filtering. *(Partial: status
      filtering is server-side as of ADR 0022 P8, with board chips (#491)
      driving a `status` query against `GET /markets`. Free-text search and
      category filtering are still open on both sides.)*
- [x] Resolved-market view: outcome, evidence summary, redemption state.
      *(Delivered by ADR 0018 (#219): the resolved surface shows the winning
      side and redemption state, and the cancelled-draw surface its
      `redeemCancelled` counterpart.)*
- [ ] Loading skeletons and granular error states on data-driven pages.
- [ ] Notification affordance for market status changes (in-app is enough
      for testnet; push/email deferred).

## Exit Criteria

With fixtures disabled and the full local stack running, a user can sign in
with Google, create a market, watch it pass review, trade receipts, see it
graduate, trade YES/NO tokens, and redeem after resolution — and a second
market can be rejected and a third refunded, with the UI explaining each
outcome. Covered by the E2E suites in ADR 0014.

## Consequences

- Postgrad UI is blocked on ADR 0010 (indexing) and ADR 0009 (API surface);
  sequence app slices behind them or build against devchain reads directly
  and swap to the API when available.
- New user-facing surfaces must keep to the designkit tokens and receipt
  language rules (`app/AGENTS.md`, `designkit/`).
