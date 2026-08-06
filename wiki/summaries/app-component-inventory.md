---
type: summary
title: App Component Inventory
description: Living inventory of the fifteen shared UI components in app/src/components and their designkit reference mappings — eight adapt a design-kit reference, three exported chart components are untracked
sources:
  - app/docs/component-inventory.md
updated: 2026-08-06
---

# App Component Inventory

`app/docs/component-inventory.md` is a **living document**, maintained via the
`component-inventory` engineering skill whenever shared components under
`app/src/components` change. It tracks only shared components — page-local and
feature-specific helpers stay out until promoted.

Its `Last audited:` header still reads **2026-07-02** while the table itself
changed in five commits through 2026-08-05. The header is stale, not the table;
treat the rows as current and the audit date as unmaintained. (Raw sources are
read-only from the wiki — flagged, not edited.)

## Production components (15)

- **Layout**: `AppNav` (sticky shell nav; create-market CTA hidden on
  `/create`; wallet account slot), `Logo` (wordmark + glyph, wordmark hidden
  below 460px).
- **Charts**: `BandStrip` (price-band clearing strip with matched / yes-only /
  no-only / no-demand legend — still static demo bands), `PriceCurve` (YES/NO
  price history — see below).
- **UI**: `Button` (primary/secondary/ghost, sm/md/lg, link support, glow;
  disabled removes link variants from tab order and blocks navigation),
  `Field` (labeled input/textarea with hint/error, mono, suffix),
  `GraduationBar` (matched-liquidity progress; optional caption, and a
  non-positive target renders an empty "target pending" bar rather than a
  divide-by-zero), `MarketCard` (discovery card: category color, status,
  outcome prices, graduation progress), `MetricCard` (compact metric tile),
  `OutcomeButton` (YES/NO price tile; renders a link with `href`, otherwise a
  real button with `aria-pressed`), `ReviewCreditCard`,
  `ReviewScoreBreakdown`, `SmallMetric` (all three new — see below),
  `SegmentedControl` (tokenized selector, `role="group"` with `aria-pressed`
  per option), `StatusPill` (market status badge, pulses on active statuses).

Eight of the fifteen are adaptations of
[designkit](../entities/designkit.md) reference components (`Button`, `Field`,
`GraduationBar`, `Logo`, `MarketCard`, `OutcomeButton`, `SegmentedControl`,
`StatusPill`) — adapted to TypeScript, Tailwind classes, domain types, and
Next.js routing rather than copied. The other seven (`AppNav`, `BandStrip`,
`PriceCurve`, `MetricCard`, `ReviewCreditCard`, `ReviewScoreBreakdown`,
`SmallMetric`) have no design-kit source; the design-kit reference table has
not grown since the kit was written. Design-kit entries are read-only.

The component set maps onto the mechanism UI: `GraduationBar`/`BandStrip`
visualize [graduation clearing](../concepts/graduation-clearing.md) progress,
`PriceCurve` shows the price path across both trading phases, and `StatusPill`
renders the [market lifecycle](../concepts/market-lifecycle.md) ladder.

## `PriceCurve` — the two-list API is gone (2026-08-05)

Superseding the 2026-08-03 design this page previously described: `PriceCurve`
no longer takes `postgradPoints` alongside a pre-graduation series. It takes
**one phase-blind `points` list** of `{at?, yesCents, noCents}`, per
[repo ADR 0025 P4](root-adr-0025-unified-price-stream.md), with `graduatedAt`
surviving only as an *annotation* — the dashed graduation rule, the shaded
venue region, and the complete-set readout — and optional `yesLabel`/`noLabel`
for creator outcome labels. Interaction affordances are unchanged: trailing
window pills (1H–1M, ALL), quarter gridlines with axis values, and a crosshair
hover readout.

The reason the merge is safe is the reason the split existed. Pre-graduation,
YES and NO come from one LMSR state so NO is exactly YES's complement; after
graduation they trade in [separate pools](../concepts/complete-sets.md) and
only sum to 100 once arbitrage closes the gap. Carrying **both** prices on
every point — rather than deriving NO from YES — is what lets one list serve
both phases, so the chart no longer needs to know which mechanism produced a
point. The server does the phase folding now
([price stream](../concepts/price-stream.md)), and the chart is phase-blind by
construction rather than by branching.

## The three review-flow components (2026-08-05)

- `ReviewCreditCard` — prepaid review-credit position. Takes `credit`
  (`MarketDraftReviewCredit | null`) and optional `onTopUp`, which renders a
  titled `CirclePlus` icon button. Tones by runs left: cyan, amber at or below
  `LOW_CREDIT_RUNS`, danger at zero. Renders **nothing** when the credit is
  null, unmetered, or priced at zero — so an unmetered deployment shows no
  credit UI at all rather than an empty card. Used in the create-draft aside
  and the portfolio metric row.
- `ReviewScoreBreakdown` — AI-review dimension scores and rationales, and the
  single definition of the seven dimensions. The two dimensions the reviewer
  scores as *risks* are **inverted for display and renamed to the safety they
  imply** (Dispute resistance, Prompt injection security), so five filled bars
  is the best outcome on every row; scores clamp and round to 0–5 before the
  flip. This is a [product honesty](../concepts/product-honesty-rule.md)
  measure in the same family as the others: a row where "high is bad" sitting
  among rows where "high is good" reads as a score, and would be misread.
  Used by the market-detail AI review card and three create-draft panels
  (feedback, approved, editing).
- `SmallMetric` — compact labelled stat: uppercase mono label over a bold
  display value. Market detail live-stats island and settled summaries.

## Three exported chart components are untracked

`app/src/components/charts/` also exports `MatchingBandsGraphic`,
`MatchingBandsHeatmap`, and `ReceiptAnatomyView`, added 2026-07-09 and never
given inventory rows. The doc's scope rule ("shared UI components in
`app/src/components`") admits them; its Update Checklist requires a row when a
shared exported component lands.

Verified against the code rather than assumed: `MatchingBandsHeatmap` and
`ReceiptAnatomyView` have **no production call sites** — they are imported only
by their own stories and tests — and `MatchingBandsGraphic` is used only by
those two. They are Storybook-only mechanism explainers. That is the likely
reason they were skipped, but the doc states no production-use qualifier, so
the gap is either three missing rows or a scope sentence that needs narrowing.
Flagged here for the inventory's next audit; not fixed, because the fix belongs
in the raw doc.

## Update checklist

Add a row when a shared exported component lands; update rows when props,
variants, usage surfaces, or design-kit mappings change; remove or mark rows on
deletion or demotion to a page-local helper. Keep design-kit entries read-only.

## Related pages

- [App workspace](../entities/app-workspace.md)
- [Designkit](../entities/designkit.md)
- [Summary: app ADR 0002 — styling and design system](app-adr-0002-styling-and-design-system.md)
- [Summary: repo ADR 0025 — unified price stream](root-adr-0025-unified-price-stream.md)
