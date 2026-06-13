The Pop Charts logo. The glyph is inline SVG, so it works anywhere with no asset path.

```jsx
<Logo />                       {/* glyph + wordmark lockup */}
<Logo variant="wordmark" size={28} />
<Logo variant="tile" size={72} />   {/* app-icon tile */}
<Logo variant="glyph" size={40} mono />
```

- `lockup` is the default nav/header mark. `tile` is the app icon (glyph on a dark rounded tile).
- "Charts" is magenta; pass `mono` for an all-white single-ink version on busy/low-contrast surfaces.
- Never redraw or recolor the glyph beyond the `mono` toggle.
