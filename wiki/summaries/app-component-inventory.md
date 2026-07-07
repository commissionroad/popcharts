---
type: summary
title: App Component Inventory
description: Living inventory of the twelve shared UI components in app/src/components and their designkit reference mappings (last audited 2026-07-02)
sources:
  - app/docs/component-inventory.md
updated: 2026-07-07
---

# App Component Inventory

`app/docs/component-inventory.md` is a **living document** (last audited
2026-07-02), maintained via the `component-inventory` engineering skill
whenever shared components under `app/src/components` change. It tracks only
shared components — page-local and feature-specific helpers stay out until
promoted.

## Production components (12)

- Layout: `AppNav` (sticky shell nav with create-market CTA and wallet
  account slot), `Logo` (wordmark + glyph, wordmark hidden below 460px).
- Charts: `BandStrip` (price-band clearing strip with matched / yes-only /
  no-only / no-demand legend — currently static demo bands), `PriceCurve`
  (YES/NO price-history chart: trailing-window pills 1H–1M/ALL, quarter
  gridlines with axis values, crosshair hover readout, optional creator
  outcome labels).
- UI: `Button` (primary/secondary/ghost, sm/md/lg, link support, glow),
  `Field` (labeled input/textarea with hint/error, mono, suffix),
  `GraduationBar` (matched-liquidity progress toward target),
  `MarketCard` (discovery card: category color, status, outcome prices,
  graduation progress), `MetricCard` (compact metric tile), `OutcomeButton`
  (YES/NO price action tile in cents, optional creator outcome label),
  `SegmentedControl` (tokenized selector), `StatusPill` (market status
  badge, pulses on active statuses).

Eight of the twelve are adaptations of [designkit](../entities/designkit.md)
reference components (`Button`, `Field`, `GraduationBar`, `Logo`,
`MarketCard`, `OutcomeButton`, `SegmentedControl`, `StatusPill`) — adapted to
TypeScript, Tailwind classes, domain types, and Next.js routing rather than
copied. `AppNav`, `BandStrip`, `PriceCurve`, and `MetricCard` have no
design-kit source. Design-kit entries are read-only references.

The component set maps directly onto the mechanism UI:
`GraduationBar`/`BandStrip` visualize
[graduation clearing](../concepts/graduation-clearing.md) progress,
`PriceCurve` shows the virtual LMSR path, and `StatusPill` renders the
[market lifecycle](../concepts/market-lifecycle.md) ladder.

## Update checklist

Add a row when a shared exported component lands; update rows when props,
variants, usage surfaces, or design-kit mappings change; remove/mark rows on
deletion or demotion to page-local helper.

## Related pages

- [App workspace](../entities/app-workspace.md)
- [Designkit](../entities/designkit.md)
- [Summary: app ADR 0002 — styling and design system](app-adr-0002-styling-and-design-system.md)
