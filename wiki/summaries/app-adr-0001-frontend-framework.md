---
type: summary
title: "App ADR 0001: Frontend Framework"
description: Accepted — build the frontend as a Next.js App Router app in React/TypeScript, Server Components by default, thin route files, interactive client islands
sources:
  - app/docs/adr/0001-frontend-framework.md
updated: 2026-07-07
---

# App ADR 0001: Adopt Next.js App Router For The Frontend App

Status: **Accepted** (2026-06-13).

## Decision

Build the production frontend as a **Next.js App Router** application using
React and TypeScript, rooted at `app/` with the route tree at `app/src/app`
(avoiding a confusing `app/app`). Alternatives considered and rejected: React
Router Framework Mode (would require establishing more conventions ourselves),
TanStack Start (still release-candidate at decision time), and a Vite React
SPA (weak for public market pages, metadata, and server boundaries).

Driving needs: shareable market/create/portfolio/graduation-clearing URLs,
fast public market pages with metadata, dense client-side interaction (wallet,
receipt placement, trade tickets), a clean server boundary for reads and
future indexer/API integration, and predictable conventions for
agent-assisted development. The design kit's React examples are visual
references, not production code to copy.

## Server/client composition rules

- Server Components by default for route composition, reads, and metadata;
  Client Components only for browser APIs, local state, wallet interaction,
  forms, charts, and other interactive islands.
- Route Handlers for public/external HTTP surfaces (webhooks, indexer
  callbacks, health checks); Server Actions only for same-app mutations.
- Route files stay mostly declarative; **never** place LMSR, receipt,
  clearing, or solvency logic in route components.
- No `use client` at route roots unless there is no smaller boundary.
- Route-level `loading.tsx`, `error.tsx`, and empty states from the first
  production slice.
- Framework escape hatches (custom servers, edge-only runtimes, nonstandard
  bundlers, replacing the data/mutation pattern) are ADR-worthy.

## Revisit when

The product becomes fully wallet/indexer driven with no SSR value, TanStack
Start stabilizes with a meaningfully better typed model, or Next.js
caching/deployment/RSC constraints block core workflows.

## Related pages

- [App workspace](../entities/app-workspace.md)
- [Summary: app ADR 0003 — domain-first module layout](app-adr-0003-domain-first-module-layout.md)
- [Deployment and infrastructure](../concepts/deployment-and-infrastructure.md) (natural Vercel deployment path is cited as a benefit)
