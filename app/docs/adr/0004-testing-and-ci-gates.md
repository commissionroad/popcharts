# ADR 0004: Establish Testing And CI Gates From The First App PR

Status: Accepted

Date: 2026-06-13

## Context

Pop Charts mixes visual polish with financially meaningful product language.
The app will display probabilities, receipts, collateral, path costs, matched
segments, refunds, and graduation state. A broken UI is bad; a misleading UI is
worse.

The first implementation should therefore start with feedback loops instead of
adding them after the codebase hardens. The relevant habit from
mattpocock/skills is a small red-green-refactor loop for new behavior and a
disciplined diagnose loop for bugs: reproduce, minimize, hypothesize,
instrument, fix, and regression-test.

## Decision

Use a layered testing strategy:

- TypeScript strict mode for static correctness.
- ESLint for Next.js, React, hooks, accessibility, imports, and project rules.
- Prettier for formatting, including Tailwind class ordering when available.
- Vitest for pure domain tests.
- React Testing Library for component behavior that does not require a real
  browser.
- fast-check for property tests around LMSR, clearing, and solvency invariants
  where properties are clearer than example-only tests.
- Playwright for end-to-end browser flows and visual snapshots of key screens.
- axe checks through Playwright or a compatible accessibility test helper once
  interactive primitives land.

Required CI checks for every PR that touches `app/`:

```txt
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:e2e:smoke
```

Full visual regression should run on app UI PRs once baselines exist. It may be
manual at first, but the expectation is that core screens are screenshot-tested
before the app becomes user-facing.

## Consequences

Positive:

- Domain math can be changed with confidence.
- Agent-written code gets fast, objective feedback.
- The design kit's distinctive visual language can be protected over time.
- Bugs should leave regression tests behind instead of relying on memory.

Tradeoffs:

- The first app PR will be slightly slower because tooling arrives with it.
- Playwright and visual snapshots need maintenance as the UI evolves.
- Property tests require careful invariant design; poor properties create noise.

## Implementation Rules

- For domain behavior, prefer test-first work. Write the failing example or
  property before changing the implementation.
- For bug fixes, start with a reproduction test whenever practical.
- Do not mock the domain layer in feature tests. Mock integrations at their
  boundaries instead.
- Keep tests close to the code for unit/component tests. Put cross-flow browser
  tests under `app/tests/e2e/`.
- Use named test fixtures for markets, receipts, price bands, and clearing
  results. Do not hide important values in anonymous objects.
- Test the honesty rules in UI copy where they affect user decisions:
  receipts are not guaranteed fills, unmatched amounts refund, and matched
  segments become backed complete sets.
- Add Playwright smoke coverage for the first version of these flows:
  discovery, create market, market detail, place receipt, graduation clearing,
  wallet connected/disconnected shell states.
- Any change to LMSR pricing, band-pass clearing, refund math, or status
  transitions must include domain tests.

## Revisit When

- CI time consistently blocks development.
- The app has stable enough UI that all core visual baselines should become
  required checks.
- A backend/protocol test suite becomes the canonical source for mechanism
  conformance and the frontend should consume shared fixtures.
