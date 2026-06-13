# Pop Charts Design System

**Pop Charts** is a no-liquidity **prediction-market launchpad**. Anyone can spin up a binary market in minutes; it prices immediately on a *virtual LMSR* curve and graduates into fully-collateralized YES/NO tokens once real opposing demand shows up. Think **pump.fun for prediction markets** — but solvent by construction.

The brand is **black + neon**, riffed from the original "Pop Charts" snack-tin logo: a toaster-pastry tile with a chart arrow bursting out and sprinkles that became the neon palette. The voice is **degen-fast but technically honest** — short, punchy, never overpromising (the whitepaper is candid that fills are deferred and partial; the brand stays just as candid).

> Tagline system: **Pop off · Bake a market · Zero liquidity. Full send. · No liquidity? No problem.**

---

## Sources

- **Brand origin:** `Pop Charts Brand.dc.html` (root) — the approved brand board (logo directions, palette, type, catchphrases, in-use mocks).
- **Product reference:** `uploads/existing_code-*.tsx` — the real PredictFun launcher (React 19 + ethers + lucide-react). Views: Create, Markets, Market detail+trade, Portfolio, Protocol. The app UI kit recreates these in-brand.
- **Whitepaper:** `uploads/whitepaper_v4.pdf` — *"PredictFun: Bootstrapping Prediction Markets With Virtual LMSR And Band-Pass Graduation Clearing"* (rev 0.4, June 2026). Source of all mechanism terminology below.
- Icons: **Lucide** (matches the codebase's `lucide-react`), loaded from CDN.
- Fonts: **Unbounded, Space Grotesk, Space Mono** — Google Fonts.

---

## Index / manifest

```
styles.css                ← link THIS (imports every token file)
tokens/                   ← colors, typography, spacing, effects, fonts
guidelines/               ← foundation specimen cards (Design System tab)
components/                ← reusable React primitives (.jsx + .d.ts + .prompt.md + card)
  brand/      Logo
  core/       Button, StatusPill, SegmentedControl
  markets/    OutcomeButton, MarketCard, GraduationBar
  forms/      Field
ui_kits/
  landing/    marketing site — index.html
  app/        product app — index.html (Discovery · Create · Market+Trade · Graduation)
assets/       logo glyph + product imagery
Pop Charts Brand.dc.html  ← original brand board
SKILL.md      ← downloadable Claude skill manifest
```

---

## Mechanism vocabulary (use these terms verbatim)

The product has a precise lifecycle. Get the words right — they drive the UI states.

| Term | Meaning | In the UI |
|---|---|---|
| **Virtual LMSR** | Pre-graduation pricing curve. `b` shapes smoothness but is backed by *no bankroll*. | The live price/odds before graduation. |
| **`b` (liquidity parameter)** | "Virtual smoothness." Higher `b` = price moves more slowly. The advanced create-market knob (default 5000). | Advanced panel in Create. |
| **Receipt (priced intent)** | A pre-graduation buy. Records the exact band of the curve it traversed — *not* a final token. Locked until clearing. | "Receipts," provisional positions. |
| **Path / price band** | The interval of probability a receipt swept (e.g. 20%→40%). | Band visualizations, position detail. |
| **Graduation** | Band-pass clearing: matches YES & NO demand that crossed the same bands in opposite directions into fully-collateralized **complete sets**. | The progress bar fills toward the matched-liquidity target. |
| **Matched / refunded** | Matched segments → CTF YES/NO tokens at recorded cost. Unmatched segments → refunded at exact path cost. | Clearing/graduation status view. |
| **Opening probability (P₀)** | A market can open at any prior (5%, 80%…), not just 50/50. | Starting YES/NO split in Create. |
| **Status ladder** | `Bootstrap → Graduating → Graduated → Resolved` (or `Refunded` if cancelled/expired). | StatusPill colors. |

**Honesty rule:** never imply a pre-graduation bet is a guaranteed fill. Worst case is a full refund — say so plainly where it matters.

---

## CONTENT FUNDAMENTALS

**Voice.** Crypto-native and fast, but never dishonest. Short declaratives. The data and the mechanism do the bragging; the copy stays tight. Confident, a little irreverent, never hype-slop ("🚀 to the moon" energy is banned — we earn the rocket through the actual launch metaphor).

**Casing.** Display headlines and wordmark in Title or sentence case (Unbounded). Tiny eyebrows and labels are UPPERCASE, mono, letter-spaced (`BOOTSTRAP`, `ADVANCED`, `RECEIPTS`). Body is sentence case. Catchphrases are punchy and end in a period — *Pop off. · Launch it hot.*

**Numbers.** Always tabular (`font-variant-numeric: tabular-nums`). Odds as bare percent ("64%") or cents with the cent sign for buy prices ("Yes 64¢ / No 36¢"). Volume abbreviates ("Vol $482.3K"). The `b` parameter shows raw ("b = 5,000"). Probabilities and bands use the en-dash ("20–40%").

**Tone examples**
- Hero: "Bake your own odds." / "Launch a market with zero startup liquidity."
- Empty state: "No markets yet. Be the first to pop one off."
- Honest caption: "Pre-graduation bets are receipts, not fills. Worst case is a full refund."
- CTA: "Pop a market →" / "Place receipt" / "Browse markets"
- Status: "Graduating — 74% of matched liquidity" / "Cleared to complete sets"

**No emoji** as UI chrome. **No "to the moon" hype.** Address the trader as a peer, sparingly using "you" (looser than the whitepaper's strict third person — this is the product surface, not the paper).

---

## VISUAL FOUNDATIONS

**Color.** Flat near-black canvas (`--pc-ink #08080A`). No page gradients. Cards are one step up (`--pc-carbon`), inputs one more (`--pc-coal`), separated by hairline borders, not shadows. Neon is **accent only** — magenta leads (primary, and the NO side), with cyan (bootstrap/live), lime (YES / graduated / positive), amber (graduating/warning), violet (resolved). Each neon has a `*-wash` low-alpha tint for chips. Never flood a surface with neon; it punctuates.

**Type.** Unbounded (display/wordmark/big odds), Space Grotesk (UI/body), Space Mono (prices, labels, addresses, the `b` value). Eyebrows are 10–11px mono uppercase, magenta or a status color.

**Backgrounds.** Flat ink. The only texture allowed is a faint neon glow *behind a specific lit element* (a CTA, a hero glyph) — never a full-page wash, never grain, never a hero gradient.

**Corners.** Rounded, always — this is the snack-pop signature. Cards `--radius-lg (18px)`, buttons/cells `--radius-md (14px)`, inputs `--radius-sm`, chips/pills `--radius-pill`. Nothing is sharp-cornered.

**Borders & dividers.** 1px. `--border` on cards and cells, `--border-soft` for internal hairline rules. Selected/active states swap the border to the relevant neon (or fill with it).

**Shadows / glow.** No ambient drop shadows. The *only* glow is colored neon (`--glow-magenta`, etc.) on an intentionally-lit element — a primary CTA, a selected outcome, the hero mark. One app-icon tile shadow exists (`--shadow-tile`) to lift the launcher icon off ink.

**Cards.** A card is a rounded bordered cell on `--surface-card`, ~28px padding, no shadow. A market card adds a status pill, a big Unbounded question, two outcome cells, a graduation bar, and a mono footer (Vol · b).

**Hover.** Buttons lift `translateY(-2px)` over 120ms; outline buttons swap border to neon; cards raise their border to `--border-strong` and may add a faint glow. Links go to `opacity: 0.7`. No color inversion on hover.

**Press.** Filled buttons settle back to `translateY(0)` and deepen to `--accent-pressed`.

**Motion.** Functional and quick (120–200ms, `--ease-default`). Allowed decorative motion: the catchphrase **marquee** (30s linear), a slow **pulse** on a live/graduating status dot, and the terminal **cursor blink**. No bounce, no spring, no scroll-jacking. Respect `prefers-reduced-motion`.

**Transparency & blur.** Sparingly: a sticky app header may use `backdrop-filter: blur(8px)` over `rgba(8,8,10,.7)`. Neon washes are the main use of alpha.

**Imagery.** There is no photography. "Imagery" = data: the price curve, band strips, the graduation progress bar, the logo glyph. Charts use the neon spectrum on ink.

---

## ICONOGRAPHY

- **UI icons: Lucide** (`stroke-width: 1.75`, `currentColor`) — matches the codebase's `lucide-react`. Load from CDN (`lucide@latest`). Common set in use: `Rocket` (launch/create), `Search` (discovery), `Wallet`, `TrendingUp`, `Coins`, `CircleDollarSign`, `Database`, `Cpu` (LMSR/curve), `Hash`, `RefreshCcw`, `CheckCircle2`, `Ban`, `Flag`, `ArrowLeft`, `ArrowUpRight`, `Eye`, `Zap`. Never recolor an icon neon unless it's a status accent; default to `--text-secondary`.
- **Brand glyph:** the Pop Charts pastry-tile + chart-arrow mark lives in `assets/pop-charts-glyph.svg` (white tile, magenta arrow, multi-neon sprinkles). Use it; do not redraw. App-icon tile = glyph centered on a dark rounded `--radius-xl` tile with `--shadow-tile`.
- **No emoji**, ever, as chrome. **No unicode glyphs as icons** except the marquee diamond `◆` (separator) and the terminal `>_` prompt in the wordmark's terminal variant.
- Provider/chain marks (USDC, Ethereum) use the providers' own marks when shown — never hand-drawn.

---

## How to use this system

1. Link `styles.css` (or paste the `:root` blocks). Reference **semantic** tokens (`--surface-card`, `--accent`, `--yes`) in product code, base ramps (`--pc-magenta`) only when defining new semantics.
2. Load the three Google Fonts (already imported by `tokens/fonts.css`).
3. Compose from `components/` — don't re-implement Button/MarketCard inside a screen.
4. Fork a `ui_kits/` screen as a starting point for new app or marketing work.
5. Keep it honest, keep it rounded, keep neon as punctuation. When in doubt: black page, one lit thing.
