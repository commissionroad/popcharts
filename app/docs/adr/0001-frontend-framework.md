# ADR 0001: Adopt Next.js App Router For The Frontend App

Status: Accepted

Date: 2026-06-13

## Context

All production frontend work will live under the repository's top-level `app/`
folder. The current repository contains the whitepaper, design kit, and
prototype React UI kit, but no production app scaffold yet.

Pop Charts is a prediction-market launchpad. The first production surface needs:

- Shareable market, create, portfolio, and graduation-clearing URLs.
- Public market pages that can render quickly and carry metadata.
- Dense client-side interaction for wallet connection, receipt placement,
  trade tickets, filters, and route transitions.
- A clean server boundary for reads, mutations, webhooks, auth/session state,
  and future indexer/API integration.
- Strong TypeScript support and predictable conventions for agent-assisted
  development.

The design kit is already React-shaped. Its examples should be treated as
visual and interaction references, not production code to copy verbatim.

Considered alternatives:

- React Router Framework Mode: a strong option with explicit route modules and
  full-stack features, but it would require us to establish more conventions
  ourselves.
- TanStack Start: technically appealing and router-first, but still marked as
  release candidate at the time of this decision.
- Vite + React SPA: fastest to start, but weaker for public market pages,
  metadata, server boundaries, and future backend-for-frontend routes.

## Decision

Build the production frontend as a Next.js App Router application using React
and TypeScript.

The top-level project root will be `app/`. To avoid a confusing `app/app`
directory, the Next.js route tree will live at `app/src/app`.

Initial app shape:

```txt
app/
  package.json
  src/
    app/          # Next.js routes, layouts, metadata, loading, error files
    components/   # shared reusable React components
    design-system/
    domain/       # pure domain logic, no React
    features/     # product flows and feature-specific UI
    integrations/ # wallet, indexer, contracts, analytics, etc.
    lib/          # small app-level helpers
```

Use Server Components by default for route composition, read-oriented data, and
metadata. Use Client Components only for browser APIs, local state, wallet
interaction, forms, charts, and other interactive islands.

Use Route Handlers for public or external HTTP surfaces such as webhooks,
indexer callbacks, health checks, and API contracts that may be consumed beyond
the web app. Use Server Actions only for same-app mutations where their coupling
to the route tree is a feature, not a liability.

## Consequences

Positive:

- Strong default conventions for routing, layouts, loading states, metadata,
  error boundaries, and server/client composition.
- Good fit for public market URLs and app-like authenticated workflows.
- Natural deployment path on Vercel while preserving standard React patterns.
- Easier to keep route files thin and move business logic into typed modules.

Tradeoffs:

- The Server Component model needs discipline. Accidental `use client` at high
  levels would erase much of the benefit.
- Next.js caching and mutation behavior must be made explicit near data access
  boundaries.
- Some wallet and browser-only libraries must be isolated behind Client
  Components.

## Implementation Rules

- Keep route files mostly declarative. They assemble data, metadata, layouts,
  and feature components.
- Never place LMSR, receipt, clearing, or solvency logic in route components.
- Do not mark route roots as `use client` unless there is no smaller client
  boundary available.
- Put interactive panels such as trade tickets, wallet controls, filters, and
  sliders behind explicit Client Component boundaries.
- Use route-level `loading.tsx`, `error.tsx`, and empty states from the first
  production slice.
- Treat framework escape hatches as ADR-worthy when they affect architecture:
  custom servers, edge-only runtime decisions, nonstandard bundler settings, or
  replacing the default data/mutation pattern.

## Revisit When

- The product becomes fully wallet/indexer driven and public SSR is proven to
  add no value.
- TanStack Start reaches stable status and provides a meaningfully better
  typed route/data model for this app.
- Next.js caching, deployment, or RSC constraints block core workflows rather
  than just requiring discipline.
