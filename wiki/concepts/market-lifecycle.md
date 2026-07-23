---
type: concept
title: Market lifecycle
description: The status ladder from UnderReview through graduation to resolution — three vocabularies (chain enum, API union, product ladder) and who drives each transition.
sources:
  - protocol/CONTEXT.md
  - docs/architecture.md
  - docs/ai-review-runner-design.md
  - app/docs/adr/0003-domain-first-module-layout.md
  - docs/adr/0007-track-verticals-with-progress-adrs.md
  - protocol/docs/adr/0011-admin-market-cancellation.md
  - docs/adr/0018-terminal-market-surface-and-redemption-ux.md
updated: 2026-07-14
---

# Market lifecycle

A market's life: creation → AI review → receipt bootstrap → graduation
clearing → postgrad trading → resolution → redemption. Deliberately expressed
in **three vocabularies with three masters** (do not unify — see
[monorepo architecture](monorepo-architecture.md)):

| Layer | Vocabulary |
|---|---|
| Chain (`MarketTypes.sol`) | UnderReview, Active, Frozen (reserved), Graduating, Graduated, Refunded, Resolved, Cancelled, Rejected |
| API (TypeBox union) | under_review, bootstrap, graduating, graduated, resolved, refunded, cancelled, rejected — `Active`→`"bootstrap"`, `Frozen` unexposed |
| Product/designkit | bootstrap → graduating → graduated → resolved, plus refunded |

## Transitions and their drivers

- **Creation → UnderReview**: no collateral escrow before review approval.
  The [AI review runner](../entities/ai-review-service.md) (or chain events
  from a manual review manager) moves it: approve→Active/bootstrap,
  reject→Rejected (terminal). Guarded updates keyed on status + metadata_hash
  keep runner verdicts and chain events from clobbering each other.
- **Active (bootstrap)**: receipts placed against the virtual LMSR — locked,
  append-only, non-withdrawable, non-transferable
  ([protocol ADR 0003](../summaries/protocol-adr-0003-v1-receipts-locked-non-transferable.md)).
  Receipts are provisional priced intents, never reinterpreted as fills.
- **Graduating → Graduated**: threshold met → freeze → [band-pass clearing](graduation-clearing.md)
  → adapter handoff. `graduationDeadline` is a deadline, not an earliest
  time; passing it while Active makes the market **Refunded** (full,
  unconditional refund).
- **Active → Cancelled (moderation kill switch)**: owner-only
  `PregradManager.cancelMarket` halts a live market whose content turns out to be
  policy-violating and opens full escrow refunds through the same
  `claimRefundedReceipt` path. Added 2026-07-11 by
  [protocol ADR 0011](../summaries/protocol-adr-0011-admin-market-cancellation.md);
  before it, a live market holding real money had **no** kill switch —
  `rejectMarket` only works pre-escrow and `markRefundable` only at the deadline.
  It is an operator action with the operator key, never an API endpoint.
- **Postgrad**: Trading → Resolved (winner redeems) or Cancelled (draw,
  half-value redemption). Resolution is post-graduation truth — never to be
  conflated with graduation (`app/src/domain/resolution/` is an intentional
  placeholder). Decision logic is designed and landing; see
  [AI-assisted resolution](ai-assisted-resolution.md).

> **"Cancelled" is two different things.** Pre-graduation, `Cancelled` is a
> *moderator removal* on `PregradManager` (escrow refunded in full, distinct from
> `Refunded`, which means "missed the deadline"). Post-graduation, cancellation
> is a *draw* on `CompleteSetBinaryMarket` (half-value redemption), a separate
> contract with its own surface. The API union exposes one `cancelled` string;
> which one it means depends on where the market is in the ladder.

**The postgrad terminal states currently have no surface** (found in the
2026-07-14 full-lifecycle test session): resolved markets regress to the
pre-graduation layout with no winning-side display or redemption UX, and the
API drops the whole `postgrad` payload for cancelled markets, so a
draw-cancelled market's venue is undiscoverable by the app.
[Root ADR 0018](../summaries/root-adr-0018-terminal-market-surface-and-redemption-ux.md)
(accepted 2026-07-14, all slices open) is the fix: the API keeps the
`postgrad` payload for any finalized graduation, and resolved/cancelled
markets get outcome banners plus wallet-signed `redeem`/`redeemCancelled`
panels — completing the redemption end of the ladder.

The lifecycle is the organizing frame for all vertical ADRs: protocol drives
transitions (0008), indexer/API project them (0010/0009), AI services gate
entry and exit (0011/0012), the app renders every stage (0013), e2e proves
them all (0014).

## Known tensions

- Whitepaper v4's lifecycle is minimal (open → frozen → graduated/not);
  the richer state vocabulary traces to the superseded v3 draft — see
  [mechanism whitepaper](mechanism-whitepaper.md).
- [App ADR 0003](../summaries/app-adr-0003-domain-first-module-layout.md)
  (2026-06-13) fixed the product ladder before the review gate existed and
  requires an ADR update to alter it; none exists — lint candidate.

## Proposed change (ADR 0022, Proposed — not yet built)

[Repo ADR 0022](../summaries/root-adr-0022-review-first-market-creation.md)
inverts the front of the lifecycle to **review-first**: a question lives as an
off-chain editable **Draft** and is AI-reviewed *before* any chain write. On
approval the creator publishes via a gated `createMarket`, so markets are **born
`Active`** and the on-chain `UnderReview` status + `approveMarket`/`rejectMarket`
are retired (the indexer would project new markets straight to `bootstrap`). Until
it lands, the on-chain-first `UnderReview → Active/Rejected` flow above is still
the reality.
