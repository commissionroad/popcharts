# Pop Charts mechanism white paper

Source of truth for the pre-graduation mechanism, per
[protocol ADR 0002](../protocol/docs/adr/0002-treat-whitepaper-v4-as-mechanism-source.md).
Imported from the `predictfun` repository, where every revision below was
written.

## Revisions

| File | Status |
| --- | --- |
| [v0.5.md](v0.5.md) | **Current.** Shortened rewrite of v0.4 with the graduation-solvency proof. Never published as a PDF. |
| [v0.4.md](v0.4.md) | Source of `documents/whitepaper_v4.pdf`. |
| [v0.3.md](v0.3.md) | Source of `documents/whitepaper_v3.pdf`. |
| [v0.2.md](v0.2.md) | Preserved. |
| [v0.1.md](v0.1.md) | Source of `documents/whitepaper_v0_1.pdf`. |

Revisions are discovered from the `v<major>.<minor>.md` filenames, so adding
one is a single new file — `latest` follows automatically.

## Building

```sh
pnpm run whitepaper
```

That renders the newest revision to `whitepaper/index.html`: a single
self-contained page with the equations pre-rendered to SVG (no network fetch at
view time). Build a specific revision with:

```sh
pnpm run whitepaper -- --version v0.4
```

## Producing a PDF

The generated page carries print styles and a **Print / Save PDF** button. Open
`whitepaper/index.html` in a browser, print to PDF, and save the result into
`documents/` as `whitepaper_v<n>.pdf`. There is no headless PDF step — the
published PDFs in `documents/` are committed artifacts, while `index.html` is
generated and ignored.
