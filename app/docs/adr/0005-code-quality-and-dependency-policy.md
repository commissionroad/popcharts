# ADR 0005: Use Explicit Code Quality And Dependency Policies

Status: Accepted

Date: 2026-06-13

## Context

The app is about to begin from an empty `app/` directory. That is the best time
to set quality defaults. Later, "we should clean this up" usually means "we
should pay interest on choices we did not write down."

We want agent-assisted development to be fast without letting the codebase turn
into a pile of one-off abstractions, hidden dependencies, and oversized files.

## Decision

Use pnpm as the package manager for the frontend app. Commit the lockfile and
pin the package manager in `app/package.json` with Corepack-compatible metadata.

Use active LTS Node.js for local development and CI. Avoid pinning to a
non-LTS runtime unless a framework or deployment decision requires it.

Use the following default quality stack when the app is scaffolded:

- TypeScript in strict mode.
- ESLint with Next.js, React, hooks, accessibility, import-order, and
  TypeScript-aware rules.
- Prettier with Tailwind class sorting when compatible with the selected
  Tailwind version.
- Husky and lint-staged for fast pre-commit checks.
- Renovate or Dependabot for dependency update PRs once the app exists.

Dependency policy:

- Prefer boring, well-maintained packages with active releases, TypeScript
  support, small APIs, and clear ownership.
- Do not add a runtime dependency for trivial utilities.
- Add an ADR or update this one for major architectural dependencies:
  authentication, wallet orchestration, contract SDKs, indexer clients,
  persistence, charting, analytics, error tracking, payments, or feature flags.
- Prefer `viem` for low-level EVM interaction. Add `wagmi` only when the React
  wallet UX needs its hooks and connector ecosystem.
- Prefer accessible headless primitives over visual component kits. Pop Charts
  owns the look.
- Keep generated code in an obvious generated directory and do not hand-edit it.

## Consequences

Positive:

- Installs are reproducible.
- Reviewers can tell whether a dependency is incidental or architectural.
- Code style arguments are mostly automated away.
- Small files and explicit boundaries make the codebase easier for humans and
  agents to navigate.

Tradeoffs:

- Hooks and lint rules can be annoying when moving quickly.
- Dependency ADRs add friction for big package decisions.
- Some hand-written helpers will exist where a package might be faster in the
  moment.

## Code Writing Rules

- Prefer named functions for domain behavior. Anonymous inline logic is fine for
  small UI callbacks, not for pricing, clearing, or formatting rules used in
  multiple places.
- Keep most functions under 50 lines. Longer functions need a clear reason,
  usually a named domain algorithm with tests.
- Keep most React components under 150 lines. Split by responsibility when a
  component mixes data loading, state machines, layout, and presentational UI.
- Keep route files thin. Route files compose; domain and feature modules decide.
- Use early returns and guard clauses instead of deep nesting.
- Use explicit discriminated unions for product states rather than boolean
  clusters.
- Avoid `any`. If an external boundary forces it, isolate it and parse into a
  typed shape immediately.
- Avoid broad barrel files that hide ownership. Small index files are fine for
  deliberate public APIs.
- Write comments for domain invariants, rounding policies, security assumptions,
  and surprising integration behavior. Do not comment obvious assignments or
  restate TypeScript types.
- Mark intentionally temporary code with `TODO(name/date): reason`, not vague
  TODOs.
- No magic numbers in mechanism code. Name constants and include units.
- Keep formatting helpers deterministic and locale-conscious. Prices, odds,
  volume, `b`, and addresses should have shared formatters.

## Operational Habits

- Maintain `app/CONTEXT.md` as shared language for humans and agents.
- Use ADRs for hard-to-reverse choices.
- Use test-first development for domain rules and regression fixes.
- Use a diagnose loop before changing code for unclear bugs.
- Run an architecture review periodically once the app has real feature weight,
  looking especially for shallow modules, route bloat, copied state machines,
  and duplicated domain language.

## Revisit When

- The app becomes a monorepo and dependency policy needs workspace-level rules.
- The team chooses a different package manager.
- Pre-commit hooks slow normal work more than they prevent broken commits.
- A framework update makes part of this quality stack obsolete.
