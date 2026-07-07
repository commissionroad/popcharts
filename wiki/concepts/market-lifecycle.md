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
updated: 2026-07-07
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
- **Postgrad**: Trading → Resolved (winner redeems) or Cancelled (draw,
  half-value redemption). Resolution is post-graduation truth — never to be
  conflated with graduation (`app/src/domain/resolution/` is an intentional
  placeholder). Nothing decides outcomes yet; see
  [AI-assisted resolution](ai-assisted-resolution.md).

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
