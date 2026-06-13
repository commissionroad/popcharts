# Architecture Decision Records

This directory records product and engineering decisions for Pop Charts.

ADRs should be short enough to read before changing code, but specific enough
to stop the same arguments from being reopened every week. The app has not been
scaffolded yet, so these initial decisions are intentionally about the ground
rules for the first implementation inside `app/`.

## Index

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-frontend-framework.md) | Accepted | Build the frontend app with Next.js App Router, React, and TypeScript. |
| [0002](0002-styling-and-design-system.md) | Accepted | Use Tailwind CSS v4 mapped to the Pop Charts design tokens. |
| [0003](0003-domain-first-module-layout.md) | Accepted | Organize code by route, domain, feature, component, and integration boundaries. |
| [0004](0004-testing-and-ci-gates.md) | Accepted | Establish typed, automated feedback loops from the first app PR. |
| [0005](0005-code-quality-and-dependency-policy.md) | Accepted | Use pnpm, small dependency surfaces, strict TypeScript, and explicit code-quality rules. |

## When To Add An ADR

Add or update an ADR when a decision:

- Changes the framework, build system, runtime, or deployment model.
- Adds a major dependency or vendor SDK that shapes the codebase.
- Defines a domain boundary, data model, contract, or invariant.
- Creates a testing, security, performance, or release policy.
- Reverses, supersedes, or materially narrows an existing ADR.

## References

- Product mechanism: `documents/whitepaper_v4.pdf`
- Design system: `designkit/readme.md`
- Design tokens: `designkit/styles.css`
- App UI kit: `designkit/ui_kits/app/index.html`
