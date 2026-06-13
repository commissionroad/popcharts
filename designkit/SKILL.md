---
name: pop-charts-design
description: Use this skill to generate well-branded interfaces and assets for Pop Charts — a no-liquidity prediction-market launchpad (virtual LMSR + band-pass graduation). Black + neon snack-pop brand. Contains design guidelines, color/type/spacing tokens, fonts, the logo glyph, reusable React components, and full landing + app UI kits for production or throwaway prototypes.
user-invocable: true
---

Read `readme.md` first — it has the brand voice, the mechanism vocabulary (virtual LMSR, receipts, band-pass graduation, the `b` parameter, the Bootstrap→Graduating→Graduated→Resolved status ladder), and the full visual foundations. Then explore the other files.

- **Tokens:** link `styles.css`. Use semantic names (`--surface-card`, `--accent`, `--yes`, `--status-graduating`).
- **Components:** `components/<group>/<Name>.jsx` with `.d.ts` contracts and `.prompt.md` usage notes. Compose these; don't reinvent them.
- **UI kits:** `ui_kits/landing/` and `ui_kits/app/` are interactive, in-brand recreations — fork a screen as a starting point.
- **Assets:** `assets/pop-charts-glyph.svg` is the brand mark. Use it; never redraw it.

If creating visual artifacts (mocks, throwaway prototypes, decks), copy assets out and produce static HTML for the user to view. If working in production code, copy assets and follow the rules here.

If invoked with no other guidance, ask what the user wants to build, ask a few scoping questions, and act as an expert Pop Charts designer who outputs HTML artifacts or production code as needed. Stay degen-fast but technically honest — never imply a pre-graduation bet is a guaranteed fill.
