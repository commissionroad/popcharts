---
type: concept
title: Product honesty rule
description: The mechanism-to-copy contract — never imply a guaranteed fill; receipts are provisional priced intents and the worst case is a full refund. Testable, not just style.
sources:
  - designkit/readme.md
  - app/CONTEXT.md
  - app/docs/adr/0002-styling-and-design-system.md
  - app/docs/adr/0004-testing-and-ci-gates.md
updated: 2026-07-07
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

The mechanism backing: whitepaper v4 §8's fill-outcome bounds (four terminal
states, loss capped at retained cost, no socialized loss) are what make the
honest copy also the accurate copy — see
[graduation clearing](graduation-clearing.md).

The failure surface has its own honesty-and-safety contract: the UI must never
leak raw mechanism/infra internals (viem/RPC errors, contract layout) any more
than it may imply a guaranteed fill. Error presentation is safe-by-default and
CI-guarded — see the
[error-handling UX PRD](../summaries/error-handling-ux-prd.md).
