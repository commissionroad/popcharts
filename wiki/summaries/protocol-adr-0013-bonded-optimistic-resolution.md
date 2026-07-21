---
type: summary
title: Protocol ADR 0013 — Bonded Optimistic Resolution With A Public Dispute Window (protocol/docs/adr/0013-bonded-optimistic-resolution-with-dispute-window.md)
description: PROPOSED — replace single-shot postgrad resolve() with propose → 24h bonded public dispute window → permissionless finalize; a dispute freezes the market for human adjudication, resolver self-dispute is the free operator-override path, and every bond movement is a paper-trail event.
sources:
  - protocol/docs/adr/0013-bonded-optimistic-resolution-with-dispute-window.md
updated: 2026-07-20
---

# Protocol ADR 0013 — Bonded Optimistic Resolution

PROPOSED 2026-07-20. Motivated by the measured fallibility of the AI
resolver ([root ADR 0019](root-adr-0019-ai-verdict-quality-program.md)):
today `resolve(side)` is terminal the instant it lands, and the only
mitigation was an off-chain operator delay that participants cannot see or
use.

## Mechanism

`Trading → proposeResolution(side)` (onlyResolver, keeps the per-side
yesNotBefore/noNotBefore floors) `→ ResolutionPending`; then either
`finalizeResolution()` (permissionless, after the immutable per-market
`disputeWindow` — 24h deployed, seconds locally; keeper-driven) `→
Resolved`, or one bonded public `dispute()` `→ Disputed`, which freezes
finalization until the resolver settles via `resolve(side)` (now the
settlement call, ungated from `Disputed`) or `cancel()` (draw; still the
never-time-gated escape hatch, callable from any non-terminal status).
Redemption paths unchanged.

Bond: flat per-market `disputeBond` in market collateral, set at
graduation via `prepareMarket`; single active dispute; refunded when the
final outcome differs from the proposal (dispute was right), forfeited to
the protocol owner otherwise; custody kept outside redemption solvency.
Resolver self-dispute skips the bond — the operator-override path,
superseding root ADR 0012's off-chain 24h delay. Bond movements emit
`DisputeBondPosted/Refunded/Forfeited` for the money paper trail.

## Positioning

Contrast case to [protocol ADR 0010](protocol-adr-0010-disable-the-clearing-challenge-window-by-default.md)
(clearing is machine-checkable → no window; resolution is real-world-fact
dependent → window). All dispute state is market-scoped so it transfers
unchanged onto the [protocol ADR 0012 singleton book](protocol-adr-0012-singleton-postgrad-position-book.md).
Breaking ABI change to a funds-holding contract → human review required.

## Open questions (Phase 0 of root ADR 0022)

Bond sizing (flat constant proposed), forfeited-bond sink (owner
proposed), disputer bounty (proposed none in v1), re-proposal semantics
(operator finality proposed in v1).

## Related pages

- [Root ADR 0022 — the cross-stack program](root-adr-0022-resolution-dispute-program.md)
- [AI-assisted resolution](../concepts/ai-assisted-resolution.md)
- [Graduation and clearing](../concepts/graduation-and-clearing.md)
