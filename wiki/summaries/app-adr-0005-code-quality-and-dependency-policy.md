---
type: summary
title: "App ADR 0005: Code Quality And Dependency Policy"
description: Accepted — pnpm + LTS Node, strict TS quality stack, ADR-gated architectural dependencies (viem-first EVM), and explicit code-writing size/style rules
sources:
  - app/docs/adr/0005-code-quality-and-dependency-policy.md
updated: 2026-07-07
---

# App ADR 0005: Use Explicit Code Quality And Dependency Policies

Status: **Accepted** (2026-06-13).

## Decision

**pnpm** is the app's package manager, with a committed lockfile and
Corepack-compatible pinning in `app/package.json`. Local dev and CI run
active LTS Node.js. Default quality stack: strict TypeScript, ESLint
(Next.js/React/hooks/a11y/import-order/TS-aware), Prettier with Tailwind
class sorting, Husky + lint-staged pre-commit checks, and Renovate/Dependabot
once the app exists.

## Dependency policy

- Prefer boring, well-maintained packages with TypeScript support, small
  APIs, and clear ownership; no runtime dependency for trivial utilities.
- Architectural dependencies require an ADR: auth, wallet orchestration,
  contract SDKs, indexer clients, persistence, charting, analytics, error
  tracking, payments, feature flags.
- Prefer **viem** for low-level EVM interaction; add wagmi only when React
  wallet UX needs its hooks/connectors.
- Prefer accessible headless primitives over visual component kits — Pop
  Charts owns the look (consistent with
  [ADR 0002](app-adr-0002-styling-and-design-system.md)).
- Generated code lives in an obvious generated directory and is never
  hand-edited.

## Code-writing rules

Named functions for domain behavior; most functions under 50 lines and React
components under 150; thin route files; early returns over deep nesting;
discriminated unions over boolean clusters; no `any` (isolate and parse at
boundaries); no broad barrel files; comments for invariants, rounding
policies, security assumptions, and surprising integration behavior;
`TODO(name/date): reason` for temporary code; no magic numbers in mechanism
code (named constants with units); deterministic, locale-conscious shared
formatters for prices, odds, volume, `b`, and addresses.

## Operational habits

Maintain `app/CONTEXT.md` as shared language ([summary](app-context.md)); use
ADRs for hard-to-reverse choices; test-first for domain rules and regression
fixes; a diagnose loop before changing code for unclear bugs; periodic
architecture reviews for shallow modules, route bloat, copied state machines,
and duplicated domain language.

## Revisit when

The app becomes a monorepo needing workspace-level dependency rules, the team
changes package manager, pre-commit hooks slow work more than they help, or a
framework update obsoletes part of the stack. (Note: the repo *is* now a
multi-workspace monorepo — see
[monorepo architecture](../concepts/monorepo-architecture.md) — while the
server uses Bun rather than pnpm; this ADR governs the app workspace only.)

## Related pages

- [App workspace](../entities/app-workspace.md)
- [Testing strategy](../concepts/testing-strategy.md)
- [Summary: app ADR 0004 — testing and CI gates](app-adr-0004-testing-and-ci-gates.md)
