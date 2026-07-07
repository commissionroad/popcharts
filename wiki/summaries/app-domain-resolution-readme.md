---
type: summary
title: App Resolution Domain README
description: Two-line note — resolution logic is an intentional placeholder in the first frontend scaffold, and must not be conflated with graduation
sources:
  - app/src/domain/resolution/README.md
updated: 2026-07-07
---

# App Resolution Domain README

`app/src/domain/resolution/README.md` is a deliberate stub. It records two
facts:

1. Resolution logic is **intentionally a placeholder** in the first frontend
   scaffold — the `domain/resolution/` module exists to reserve the boundary
   from [app ADR 0003](app-adr-0003-domain-first-module-layout.md) before any
   real logic lands.
2. Graduation and trading surfaces must **not treat resolution as the same
   concept as market graduation**. Resolution is the post-graduation truth
   outcome; graduation is the receipts-to-complete-sets transition (see the
   [app context glossary](app-context.md), which lists "graduation" as a word
   to avoid when meaning resolution).

Anything the app eventually does here should stay consistent with the
protocol-side resolution flow, including
[AI-assisted resolution](../concepts/ai-assisted-resolution.md).

## Related pages

- [App workspace](../entities/app-workspace.md)
- [Market lifecycle](../concepts/market-lifecycle.md)
