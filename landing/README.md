# Pop Charts Landing Page

The marketing site served at `https://popcharts.xyz`. Static — no build step,
no framework: `index.html`, `styles.css`, and `assets/`.

## Provenance

The page is the approved marketing layout from the design system
(`designkit/ui_kits/landing/index.html`), adapted for standalone hosting:

- `styles.css` is a flattened copy of `designkit/styles.css` (which is an
  `@import` manifest over `designkit/tokens/*.css`). The designkit is
  read-only; if its tokens change, re-flatten from there rather than
  hand-editing values here.
- `assets/pop-charts-glyph.svg` is copied from `designkit/assets/`.
- CTAs point at `https://app.popcharts.xyz`. The waitlist form from the mock
  was replaced with an "Open the app" CTA, and the markets section is labeled
  as a preview with sample data (product honesty rule: nothing implies live
  volume or guaranteed fills).

Fonts (Unbounded, Space Grotesk, Space Mono) and Lucide icons load from
public CDNs, matching the designkit's documented approach.

## Deploying

The site is deployed to the `popcharts-landing` project in the
CommissionRoad hosting team, with `popcharts.xyz` as its production domain.
Any redeploy uploads these three files as-is (no build). See
`docs/deployment/go-live-dns.md` for the domain/DNS runbook and the current
go-live state.
