# Component Inventory

Status: Living document
Last audited: 2026-07-02

Maintained with `skills/engineering/component-inventory/SKILL.md`.

## Scope

This inventory tracks shared UI components in `app/src/components` and their
relationship to reference components in `designkit/components`. Page-local
helpers and feature-specific components stay out of this list until they are
promoted into `app/src/components`.

## Production Components

| Component          | File                                          | Design-kit source                       | Purpose                              | Public inputs / variants                                                                                                                                                                                                             | Current use                                                                              |
| ------------------ | --------------------------------------------- | --------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `AppNav`           | `app/src/components/layout/app-nav.tsx`       | None                                    | Sticky app shell navigation          | Active route from `usePathname`; create-market CTA hidden on `/create`; wallet account button slot                                                                                                                                   | `app/src/app/layout.tsx`                                                                 |
| `Logo`             | `app/src/components/layout/logo.tsx`          | `designkit/components/Logo`             | Header wordmark and glyph lockup     | No props; hides wordmark below 460px                                                                                                                                                                                                 | `AppNav`                                                                                 |
| `BandStrip`        | `app/src/components/charts/band-strip.tsx`    | None                                    | Price-band clearing strip            | Static demo bands; legend states for matched, yes-only, no-only, no demand                                                                                                                                                           | Graduation clearing feature                                                              |
| `PriceCurve`       | `app/src/components/charts/price-curve.tsx`   | None                                    | YES/NO price-history chart           | `points`, optional `yesLabel`/`noLabel`; trailing-window pills (1H-1M, ALL), quarter gridlines with axis values, crosshair hover readout                                                                                             | Market detail feature                                                                    |
| `Button`           | `app/src/components/ui/button.tsx`            | `designkit/components/Button`           | Brand button/link primitive          | Variants `primary`, `secondary`, `ghost`; sizes `sm`, `md`, `lg`; `href`, `leftIcon`, `rightIcon`, `glow`; disabled state removes link variants from tab order and blocks navigation; handlers/aria props forwarded to both variants | App nav, error pages, create flow, market detail dev actions, graduation, receipt ticket |
| `Field`            | `app/src/components/ui/field.tsx`             | `designkit/components/Field`            | Labeled input/textarea field         | `label`, `id`, `hint`, `error`, `mono`, `multiline`, `suffix`, standard input props                                                                                                                                                  | Create-market form, receipt ticket                                                       |
| `GraduationBar`    | `app/src/components/ui/graduation-bar.tsx`    | `designkit/components/GraduationBar`    | Matched-liquidity progress indicator | `matchedUsd`, `targetUsd`, optional `height`, optional caption; non-positive target renders an empty "target pending" bar                                                                                                            | Market cards, market detail, graduation clearing                                         |
| `MarketCard`       | `app/src/components/ui/market-card.tsx`       | `designkit/components/MarketCard`       | Discovery card for a market          | `market`; category color, status, outcome prices, graduation progress                                                                                                                                                                | Market discovery board                                                                   |
| `MetricCard`       | `app/src/components/ui/metric-card.tsx`       | None                                    | Compact metric tile                  | `label`, `value`, optional `icon`, optional `tone`                                                                                                                                                                                   | Market detail, graduation clearing, portfolio                                            |
| `OutcomeButton`    | `app/src/components/ui/outcome-button.tsx`    | `designkit/components/OutcomeButton`    | YES/NO price action tile             | `side`, `priceCents`, optional `label` (creator outcome label), `href`, `onClick`, `selected`, `sub`; renders a link with `href`, otherwise a real button with `aria-pressed`                                                        | Market cards                                                                             |
| `SegmentedControl` | `app/src/components/ui/segmented-control.tsx` | `designkit/components/SegmentedControl` | Tokenized segmented selector         | `options`, `value`, `onChange`, optional `size`, `full`, `accentBy`, `className`; `role="group"` with `aria-pressed` per option                                                                                                      | Discovery filters, receipt ticket                                                        |
| `StatusPill`       | `app/src/components/ui/status-pill.tsx`       | `designkit/components/StatusPill`       | Market status badge                  | `status`, optional `label`, `size`, `className`; pulse on active statuses                                                                                                                                                            | Market cards, market detail, create flow, graduation clearing                            |

## Design-Kit References

| Reference                               | Production component | Notes                                                                   |
| --------------------------------------- | -------------------- | ----------------------------------------------------------------------- |
| `designkit/components/Button`           | `Button`             | Adapted to TypeScript, Tailwind classes, and Next.js link support.      |
| `designkit/components/Field`            | `Field`              | Adapted to typed input/textarea props and accessible hint/error wiring. |
| `designkit/components/GraduationBar`    | `GraduationBar`      | Adapted to domain progress calculation and compact card mode.           |
| `designkit/components/Logo`             | `Logo`               | Adapted to Next.js image asset and responsive wordmark behavior.        |
| `designkit/components/MarketCard`       | `MarketCard`         | Adapted to domain `Market` records and production routing.              |
| `designkit/components/OutcomeButton`    | `OutcomeButton`      | Adapted to yes/no side typing and optional link behavior.               |
| `designkit/components/SegmentedControl` | `SegmentedControl`   | Adapted to typed options and optional value-based accenting.            |
| `designkit/components/StatusPill`       | `StatusPill`         | Adapted to production market statuses and status token mapping.         |

## Update Checklist

- Add a production row when a shared exported component is added under
  `app/src/components`.
- Update rows when props, variants, states, usage surfaces, or design-kit
  mappings change.
- Remove or mark rows when a component is deleted, folded into another
  component, or demoted back to a page-local helper.
- Keep design-kit entries read-only unless a task explicitly changes
  `designkit/`.
