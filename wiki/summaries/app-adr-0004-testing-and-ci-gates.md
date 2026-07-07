---
type: summary
title: "App ADR 0004: Testing And CI Gates"
description: Accepted — layered testing (strict TS, ESLint, Vitest, RTL, fast-check, Playwright, axe) with lint/typecheck/unit/e2e-smoke required on every app PR from day one
sources:
  - app/docs/adr/0004-testing-and-ci-gates.md
updated: 2026-07-07
---

# App ADR 0004: Establish Testing And CI Gates From The First App PR

Status: **Accepted** (2026-06-13).

## Context

The app displays financially meaningful values — probabilities, receipts,
collateral, path costs, matched segments, refunds, graduation state. "A broken
UI is bad; a misleading UI is worse." Feedback loops therefore start with the
first PR, not after the codebase hardens.

## Decision — the layered strategy

- TypeScript strict mode; ESLint (Next.js, React, hooks, a11y, imports);
  Prettier with Tailwind class ordering.
- **Vitest** for pure domain tests; **React Testing Library** for
  non-browser component behavior.
- **fast-check** property tests around LMSR, clearing, and solvency
  invariants where properties beat examples.
- **Playwright** for end-to-end flows and visual snapshots; **axe**
  accessibility checks once interactive primitives land.

Required CI for every PR touching `app/`: `pnpm install --frozen-lockfile`,
`pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm test:e2e:smoke`. Full
visual regression runs on UI PRs once baselines exist (may start manual, but
core screens must be screenshot-tested before the app is user-facing).

## Implementation rules

- Test-first for domain behavior; reproduction tests for bug fixes.
- **Do not mock the domain layer** in feature tests — mock integrations at
  their boundaries.
- Unit/component tests live next to code; cross-flow browser tests under
  `app/tests/e2e/`. (The README and app structure list `src/tests/e2e/` —
  minor path discrepancy.)
- Named fixtures for markets, receipts, price bands, clearing results.
- Test the **honesty rules** in UI copy where they affect decisions:
  receipts are not guaranteed fills, unmatched amounts refund, matched
  segments become backed complete sets.
- Playwright smoke coverage for: discovery, create market, market detail,
  place receipt, graduation clearing, wallet connected/disconnected shells.
- Any change to LMSR pricing, band-pass clearing, refund math, or status
  transitions must include domain tests.

## Revisit when

CI time blocks development, visual baselines are stable enough to become
required, or a backend/protocol suite becomes the canonical mechanism
conformance source (frontend would consume shared fixtures).

## Related pages

- [Testing strategy](../concepts/testing-strategy.md)
- [App workspace](../entities/app-workspace.md)
- [Summary: app ADR 0005 — code quality and dependency policy](app-adr-0005-code-quality-and-dependency-policy.md)
