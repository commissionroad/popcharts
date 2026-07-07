---
type: summary
title: App ADR Index
description: Index of the five accepted frontend ADRs plus the policy for when an app decision deserves a new ADR
sources:
  - app/docs/adr/README.md
updated: 2026-07-07
---

# App ADR Index

`app/docs/adr/README.md` is a thin index of the frontend's architecture
decision records plus a short policy section. All five initial ADRs are
**Accepted** and deliberately cover the ground rules for implementation inside
the top-level `app/` folder:

| ADR | Decision | Summary page |
| --- | --- | --- |
| 0001 | Next.js App Router, React, TypeScript | [summary](app-adr-0001-frontend-framework.md) |
| 0002 | Tailwind CSS v4 mapped to Pop Charts design tokens | [summary](app-adr-0002-styling-and-design-system.md) |
| 0003 | Route/domain/feature/component/integration boundaries | [summary](app-adr-0003-domain-first-module-layout.md) |
| 0004 | Typed, automated feedback loops from the first app PR | [summary](app-adr-0004-testing-and-ci-gates.md) |
| 0005 | pnpm, small dependency surfaces, strict TS, code-quality rules | [summary](app-adr-0005-code-quality-and-dependency-policy.md) |

## When to add an ADR

Add or update an ADR when a decision changes the framework/build/runtime/
deployment model, adds a major dependency or vendor SDK, defines a domain
boundary/data model/contract/invariant, creates a testing/security/
performance/release policy, or reverses/supersedes an existing ADR.

## References

The index points to the mechanism whitepaper (`documents/whitepaper_v4.pdf` —
see [mechanism whitepaper](../concepts/mechanism-whitepaper.md)) and to the
design kit (`designkit/readme.md`, `designkit/styles.css`, and the app UI kit
HTML — see [designkit](../entities/designkit.md)).

## Related pages

- [App workspace](../entities/app-workspace.md)
