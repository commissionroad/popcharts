---
type: summary
title: Repo ADR 0013 — App feature completion
description: Vertical ADR to complete the app across the full market lifecycle — Google sign-in verification, graduation UX, postgrad trading/redemption, unhappy-path surfaces, search and polish; 2 of 14 done as of the 2026-07-09 reconcile (postgrad-mode market detail, receipt-state copy).
sources:
  - docs/adr/0013-app-feature-completion.md
updated: 2026-07-13
---

# Repo ADR 0013: App Feature Completion

**Status: Accepted.** Dated 2026-07-06. Vertical checklist per ADR 0007
([summary](root-adr-0007-track-verticals-with-progress-adrs.md)).

## Context

The pregrad journey in `app/` is polished: discovery, market detail with the
LMSR curve and AI review evidence, a full create flow with on-chain creation,
receipt placement with the ERC20 approve flow, and a receipts portfolio. Privy
is configured with `loginMethods: ["email", "google", "wallet"]`
(`src/integrations/wallet/wallet-config.ts`), and the market-detail graduate
button already calls a server action.

Missing: everything after graduation (no postgrad trading, positions, or
redemption UI), the unhappy-path surfaces (rejection feedback, refund claims),
the graduation-page trigger, and a tail of small product features.

## Decision

Complete the app across the full market lifecycle, consuming the API and
service surfaces from ADRs 0009–0012 as they land. Fixture fallback stays for
local development, but every flow must work with fixtures disabled.

## Progress (2 of 14 done as of the 2026-07-09 checklist reconcile)

Auth:

- [ ] Verify Google sign-in end to end against a real Privy app (config
  exists; needs dashboard enablement and a tested login → wallet →
  transaction path).
- [ ] Account/profile page: linked login methods, active wallet, disconnect.

Graduation:

- [ ] Wire the graduation page's "Graduate market" button (share one flow with
  the market-detail button that already calls `graduateMarketAction`, with
  pending/success/error states reflecting chain state).
- [ ] Graduation outcome view driven by real clearing results (matched bands,
  refunds) once the clearing keeper (ADR 0008) emits them.

Postgrad trading:

- [x] Market detail switches to postgrad mode after graduation: YES/NO prices
  from the v4 venue, trade ticket for outcome tokens (approve/buy/sell against
  `BoundedPoolOrderManager`).
- [ ] Portfolio shows postgrad positions and P&L alongside pregrad receipts.
- [ ] Redemption/claims UX: claim graduated receipts, redeem winning tokens
  after resolution, claim refunds on refunded markets.

Unhappy paths:

- [ ] Rejected-market view with user-appropriate AI rejection reasons (from
  ADR 0011) and what the creator can change before resubmitting.
- [ ] Refund flows surfaced wherever a market lands in `refunded`/closed
  states, not only behind dev tools.
- [x] Receipt states communicate the full range of outcomes (matched,
  partially matched, refunded) after clearing.

Small features:

- [ ] Market search and richer category/status filtering against the API
  (ADR 0009), replacing client-side-only filtering.
- [ ] Resolved-market view: outcome, evidence summary, redemption state.
- [ ] Loading skeletons and granular error states on data-driven pages.
- [ ] Notification affordance for market status changes (in-app is enough for
  testnet; push/email deferred).

## Exit criteria

With fixtures disabled and the full local stack running: a user signs in with
Google, creates a market, watches it pass review, trades receipts, sees it
graduate, trades YES/NO tokens, and redeems after resolution — while a second
market is rejected and a third refunded, with the UI explaining each outcome.
Covered by the ADR 0014 E2E suites.

## Consequences

Postgrad UI is blocked on ADR 0010 (indexing) and ADR 0009 (API surface):
sequence app slices behind them, or build against devchain reads directly and
swap to the API later. New user-facing surfaces must keep to the designkit
tokens and receipt language rules (`app/AGENTS.md`, `designkit/`).

## Related pages

- [../entities/app-workspace.md](../entities/app-workspace.md)
- [../entities/designkit.md](../entities/designkit.md)
- [../entities/postgrad-market.md](../entities/postgrad-market.md)
- [../entities/server-workspace.md](../entities/server-workspace.md)
- [../entities/devchain.md](../entities/devchain.md)
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md)
- [../concepts/graduation-clearing.md](../concepts/graduation-clearing.md)
- [../concepts/ai-assisted-resolution.md](../concepts/ai-assisted-resolution.md)
