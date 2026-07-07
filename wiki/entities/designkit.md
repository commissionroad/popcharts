---
type: entity
title: designkit/
description: Read-only design-system source of truth — brand voice, mechanism vocabulary, black+neon visual foundations, and component references the app adapts.
sources:
  - designkit/readme.md
  - app/docs/adr/0002-styling-and-design-system.md
  - app/docs/component-inventory.md
  - protocol/CONSTITUTION.md
updated: 2026-07-07
---

# designkit/

Reference material, not a code workspace: brand assets, design tokens,
component guidelines. Production code **adapts** kit references (8 of the
app's 12 shared components trace to it), never copies inline-style JSX;
Tailwind v4 maps to the kit's semantic tokens
([app ADR 0002](../summaries/app-adr-0002-styling-and-design-system.md)).

- Visual language: black+neon (neon as accent only), rounded radii as brand
  signature, fonts Unbounded/Space Grotesk/Space Mono, Lucide icons.
- Its vocabulary table mirrors whitepaper terms verbatim (receipts as
  provisional locked intents, matched liquidity, band-pass clearing) — and
  the [product honesty rule](../concepts/product-honesty-rule.md) originates
  here. The protocol constitution treats the kit as the product-surface
  source of truth: reads/events must support a receipt-centric UI without
  ambiguous offchain reconstruction.
- Staleness: the kit README still says "PredictFun", points at pre-rename
  `uploads/` paths, and calls matched outcomes "CTF YES/NO tokens" (an
  implementation detail [protocol ADR 0008](../summaries/protocol-adr-0008-complete-set-erc20-arc-testnet.md)
  deviated from). See [designkit summary](../summaries/designkit-readme.md).

## Related pages

- [App workspace](app-workspace.md) — the consumer
