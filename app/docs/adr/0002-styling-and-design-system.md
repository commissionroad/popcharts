# ADR 0002: Use Tailwind CSS v4 Mapped To Pop Charts Design Tokens

Status: Accepted

Date: 2026-06-13

## Context

The repository already contains a complete Pop Charts design kit:

- `designkit/readme.md` defines the product vocabulary, voice, color, type,
  spacing, radius, hover, motion, icon, and honesty rules.
- `designkit/tokens/*.css` defines semantic tokens such as `--surface-card`,
  `--accent`, `--yes`, `--status-graduating`, and `--radius-lg`.
- `designkit/components/*` provides React-shaped component references.
- `designkit/ui_kits/app/index.html` demonstrates the primary app flows:
  discovery, create, market detail, trade ticket, and graduation clearing.

The kit intentionally uses a black + neon, trader-tool feel. Its cards use
larger snack-pop radii than generic product UI. That is a brand requirement,
not a design-system accident.

The prototype code uses inline styles and duplicated primitives. Production
code should preserve the visual language without carrying over those prototype
implementation choices.

## Decision

Use Tailwind CSS v4 as the styling system for production React components, with
Tailwind theme variables mapped to the Pop Charts CSS custom properties.

Copy the relevant token files into the app during scaffold, preserving semantic
token names. Product code should use semantic names first:

- Good: `--surface-card`, `--surface-raised`, `--border`, `--accent`, `--yes`.
- Avoid in product code: raw neon ramp names like `--pc-magenta`, except inside
  token/theme definition files.

Use `next/font/google` for the three brand fonts:

- Unbounded for display, wordmark, and large odds.
- Space Grotesk for UI and body.
- Space Mono for prices, labels, addresses, `b`, receipts, and compact data.

Use `lucide-react` for icons. Use Radix UI or shadcn/ui primitives only where
they provide accessibility and behavior we should not reimplement, such as
dialogs, menus, popovers, tabs, tooltips, and form primitives. Pop Charts owns
the visual styling.

## Consequences

Positive:

- The app can move quickly without inventing one-off CSS for every screen.
- Tailwind classes make component layout visible at the call site while tokens
  keep the brand centralized.
- The design kit remains the source of visual truth instead of becoming stale
  prototype code.
- Accessible primitives can be adopted without importing a generic visual
  language.

Tradeoffs:

- Token mapping has to be maintained deliberately when the design kit changes.
- Tailwind class strings can become noisy if component boundaries are weak.
- CSS variables need testing across dark surfaces, focus states, and chart-like
  data visuals.

## Implementation Rules

- Place copied/adapted tokens under `app/src/design-system/`.
- Keep `designkit/` read-only as a source reference unless a task explicitly
  asks to change the design kit.
- Build production components in TypeScript, not by copying inline-style JSX.
- Prefer class-based styling. Inline styles are allowed only for truly dynamic
  values such as computed widths, chart coordinates, or CSS custom property
  overrides.
- Encode component variants with clear APIs. Use simple typed props first; use
  class-variance-authority only when variant composition becomes repetitive.
- Preserve the design kit's honesty rule in UI copy: pre-graduation bets are
  receipts, fills are partial and not guaranteed, and unmatched amounts refund.
- Preserve the brand radius system. Do not flatten card radii to generic 8px
  defaults unless a future design-system ADR changes the visual language.
- Respect `prefers-reduced-motion`. Motion should be functional and quick.
- Use visual snapshots for the core app screens once the first screen set lands.

## Revisit When

- The design system moves to a generated token pipeline.
- Tailwind class noise consistently hides component intent.
- A component library becomes necessary for speed, accessibility, or team
  consistency, and its visual defaults can be fully tokenized.
