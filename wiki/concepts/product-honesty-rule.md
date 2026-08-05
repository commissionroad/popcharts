---
type: concept
title: Product honesty rule
description: The mechanism-to-copy contract — never imply a guaranteed fill, and never present pre-graduation withdrawal as free exit; receipts are provisional priced intents and the worst case is a full refund. Testable, not just style.
sources:
  - designkit/readme.md
  - app/CONTEXT.md
  - app/docs/adr/0002-styling-and-design-system.md
  - app/docs/adr/0004-testing-and-ci-gates.md
  - protocol/docs/adr/0014-pre-graduation-withdrawals-and-fees.md
updated: 2026-08-05
---

# Product honesty rule

A first-class, cross-document contract between the mechanism and the UI:
because fills are deferred and partial (receipts may be fully refunded at
graduation), **no surface may imply a guaranteed fill or ownership of outcome
tokens before graduation**. The worst case — full refund at exact cost — must
stay visible.

- Origin: the [designkit](../entities/designkit.md) honesty rule and tone
  examples; the whitepaper itself is candid that fills are deferred, and the
  brand must stay as candid.
- Vocabulary enforcement: `app/CONTEXT.md` maintains avoid-words ("virtual
  share", fill-implying language); receipts are always "provisional locked
  priced intents" ([protocol ADR 0003](../summaries/protocol-adr-0003-v1-receipts-locked-non-transferable.md)
  requires the product to label them so).
- UI copy preserving the rule is a stated requirement of
  [app ADR 0002](../summaries/app-adr-0002-styling-and-design-system.md) and
  **tested** per [app ADR 0004](../summaries/app-adr-0004-testing-and-ci-gates.md).

## Withdrawal is not free exit

[Protocol ADR 0014](../summaries/protocol-adr-0014-pre-graduation-withdrawals-and-fees.md)
made receipts withdrawable before graduation, superseding the non-withdrawable
half of [ADR 0003](../summaries/protocol-adr-0003-v1-receipts-locked-non-transferable.md)
(they stay non-transferable). That is a second place the copy can overstate what
the mechanism gives, and the ADR says so itself: simulated over random books,
**~15% of escrow becomes withdrawable and ~86% of the book stays locked** — "this
is not free exit and the product must not present it as one."

Two mechanism facts the copy must respect:

- **Opposed bands stay locked for both receipts until clearing.** Only bands
  that are *not* opposed may be withdrawn before the freeze. A user's
  withdrawable amount is a property of the book, not of their intent — so no
  surface may imply a receipt can simply be cancelled.
- **Withdrawal is not free of charge.** A 5% withdrawal fee (`φ_out`) applies to
  the recorded cost of a withdrawn band, and the refund is that band's own
  recorded path cost less the fee — not the position's mark value.

So the honesty rule now has two clauses that fail the same way: never imply a
guaranteed fill, and never imply a guaranteed exit.

The mechanism backing: whitepaper v4 §8's fill-outcome bounds (four terminal
states, loss capped at retained cost, no socialized loss) are what make the
honest copy also the accurate copy — see
[graduation clearing](graduation-clearing.md).

The failure surface has its own honesty-and-safety contract: the UI must never
leak raw mechanism/infra internals (viem/RPC errors, contract layout) any more
than it may imply a guaranteed fill. Error presentation is safe-by-default and
CI-guarded — see the
[error-handling UX PRD](../summaries/error-handling-ux-prd.md).
