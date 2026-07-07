---
type: summary
title: "App ADR 0002: Styling And Design System"
description: Accepted — Tailwind CSS v4 mapped to Pop Charts semantic design tokens, brand fonts via next/font, lucide-react icons, Radix/shadcn only for accessibility primitives
sources:
  - app/docs/adr/0002-styling-and-design-system.md
updated: 2026-07-07
---

# App ADR 0002: Use Tailwind CSS v4 Mapped To Pop Charts Design Tokens

Status: **Accepted** (2026-06-13).

## Decision

Use **Tailwind CSS v4** for production styling, with Tailwind theme variables
mapped to the Pop Charts CSS custom properties from the
[design kit](../entities/designkit.md). Token files are copied into
`app/src/design-system/` during scaffold, preserving semantic names. Product
code uses semantic tokens (`--surface-card`, `--surface-raised`, `--border`,
`--accent`, `--yes`) — raw neon ramp names like `--pc-magenta` are reserved
for token/theme definition files.

Typography via `next/font/google`: **Unbounded** (display, wordmark, large
odds), **Space Grotesk** (UI/body), **Space Mono** (prices, labels, addresses,
`b`, receipts, compact data). Icons via **lucide-react**. Radix UI / shadcn/ui
primitives are allowed only where they provide accessibility and behavior not
worth reimplementing (dialogs, menus, popovers, tabs, tooltips, form
primitives) — Pop Charts owns the visual styling.

## Context worth keeping

The kit's black + neon, trader-tool feel and larger snack-pop card radii are a
**brand requirement**, not an accident. The prototype's inline styles and
duplicated primitives should not be carried into production.

## Implementation rules

- `designkit/` stays read-only as a source reference unless a task explicitly
  changes it.
- Class-based styling; inline styles only for truly dynamic values (computed
  widths, chart coordinates, CSS variable overrides).
- Typed props for variants first; class-variance-authority only when variant
  composition becomes repetitive.
- Preserve the design kit's **honesty rule** in UI copy: pre-graduation bets
  are receipts, fills are partial and not guaranteed, unmatched amounts
  refund.
- Preserve the brand radius system — no flattening card radii to generic 8px.
- Respect `prefers-reduced-motion`; motion is functional and quick.
- Visual snapshots for core app screens once the first screen set lands.

## Revisit when

The design system moves to a generated token pipeline, Tailwind class noise
hides intent, or a fully tokenizable component library becomes necessary.

## Related pages

- [Designkit](../entities/designkit.md)
- [App workspace](../entities/app-workspace.md)
- [Summary: designkit readme](designkit-readme.md)
- [Testing strategy](../concepts/testing-strategy.md) (visual snapshot expectation)
