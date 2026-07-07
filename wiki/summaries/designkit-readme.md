---
type: summary
title: Designkit README
description: The design-system source of truth — brand voice, mechanism vocabulary table, black+neon visual foundations, typography, iconography, and usage rules
sources:
  - designkit/readme.md
updated: 2026-07-07
---

# Designkit README

`designkit/readme.md` is the source of visual and verbal truth for the
[design kit](../entities/designkit.md). It frames Pop Charts as a
no-liquidity prediction-market launchpad — "pump.fun for prediction markets,
but solvent by construction" — with a **black + neon** brand derived from the
snack-tin logo and a voice that is "degen-fast but technically honest."
Tagline system: *Pop off · Bake a market · Zero liquidity. Full send. · No
liquidity? No problem.*

## Contents and provenance

The kit ships `styles.css` (imports every token file), `tokens/`,
`guidelines/`, React reference `components/` (brand: Logo; core: Button,
StatusPill, SegmentedControl; markets: OutcomeButton, MarketCard,
GraduationBar; forms: Field), `ui_kits/` for landing and app screens, assets,
the original brand board, and a `SKILL.md` manifest. Its cited sources are
the brand board, the original "PredictFun" launcher code
(`uploads/existing_code-*.tsx`), and `uploads/whitepaper_v4.pdf` —
*"PredictFun: Bootstrapping Prediction Markets With Virtual LMSR And
Band-Pass Graduation Clearing"* (rev 0.4, June 2026), the source of all
mechanism terminology (see
[mechanism whitepaper](../concepts/mechanism-whitepaper.md); note the
pre-rename "PredictFun" naming and `uploads/` paths — the repo keeps the
whitepaper under `documents/`).

## Mechanism vocabulary ("use these terms verbatim")

The README carries its own vocabulary table: virtual LMSR, `b` ("virtual
smoothness," default 5000, the advanced create-market knob), receipt (priced
intent), path/price band, graduation via band-pass clearing into complete
sets, matched vs refunded segments (matched → "CTF YES/NO tokens" at recorded
cost), opening probability P₀ (markets can open at any prior, not just
50/50), and the status ladder `Bootstrap → Graduating → Graduated → Resolved`
(or `Refunded` if cancelled/expired) driving StatusPill colors. The
**honesty rule**: never imply a pre-graduation bet is a guaranteed fill;
worst case is a full refund — say so plainly. See
[market lifecycle](../concepts/market-lifecycle.md),
[graduation clearing](../concepts/graduation-clearing.md), and
[complete sets](../concepts/complete-sets.md).

## Content and visual foundations

- **Voice/casing/numbers**: short declaratives, no hype-slop or emoji chrome;
  UPPERCASE mono eyebrows; tabular numerals everywhere; odds as bare percent,
  buy prices in cents ("Yes 64¢ / No 36¢"), abbreviated volume, raw `b`
  ("b = 5,000"), en-dash bands ("20–40%").
- **Color**: flat near-black canvas (`--pc-ink #08080A`), no page gradients;
  cards on `--pc-carbon`, inputs on `--pc-coal`, hairline borders not
  shadows. Neon is accent only — magenta leads (primary and NO), cyan
  (bootstrap/live), lime (YES/graduated/positive), amber
  (graduating/warning), violet (resolved), each with a `*-wash` tint.
- **Type**: Unbounded (display/wordmark/big odds), Space Grotesk (UI/body),
  Space Mono (prices, labels, addresses, `b`).
- **Corners**: rounded always — the snack-pop signature: cards
  `--radius-lg (18px)`, buttons `--radius-md (14px)`, inputs `--radius-sm`,
  pills `--radius-pill`.
- **Glow/motion**: no ambient drop shadows; only intentional neon glow on a
  lit element. Motion functional and quick (120–200ms); allowed decoration is
  the marquee, a slow status-dot pulse, and the terminal cursor blink;
  respect `prefers-reduced-motion`.
- **Imagery**: no photography — "imagery" is data (price curve, band strips,
  graduation bar, logo glyph). Icons are Lucide (stroke 1.75,
  `currentColor`); the brand glyph SVG is used, never redrawn.

## Usage rules

Link `styles.css`; reference semantic tokens (`--surface-card`, `--accent`,
`--yes`) in product code and base ramps only when defining new semantics;
compose from `components/` rather than re-implementing primitives; fork a
`ui_kits/` screen as a starting point; "keep it honest, keep it rounded, keep
neon as punctuation. When in doubt: black page, one lit thing." The
production adoption of these rules is
[app ADR 0002](app-adr-0002-styling-and-design-system.md), and the mapping of
kit components to production ones lives in the
[component inventory](app-component-inventory.md).

## Related pages

- [Designkit](../entities/designkit.md)
- [App workspace](../entities/app-workspace.md)
