# Pop Charts Skills

This directory vendors a focused set of engineering skills from
[mattpocock/skills](https://github.com/mattpocock/skills) to guide the first
production pass of the Pop Charts app.

Imported from upstream commit:
`694fa30311e02c2639942308513555e61ee84a6f`.

Upstream license: MIT. See
[`LICENSE-MIT-mattpocock-skills`](./LICENSE-MIT-mattpocock-skills).

`engineering/pull-requests` and `engineering/clean-code` are local Pop Charts
additions, not vendored from upstream.

## Why These Skills

- `engineering/grill-with-docs` keeps domain terms and hard decisions explicit
  in `CONTEXT.md` and ADRs before code spreads fuzzy language.
- `engineering/tdd` pushes vertical-slice red/green/refactor work for the
  app's core behavior, especially LMSR math, receipts, and graduation clearing.
- `engineering/diagnose` gives a disciplined loop for bugs, regressions, and
  flaky app behavior: reproduce, minimize, hypothesize, instrument, fix, and
  regression-test.
- `engineering/improve-codebase-architecture` helps keep modules deep and
  testable as the frontend grows beyond the initial launch surface.
- `engineering/prototype` gives a sanctioned way to explore UI or state-machine
  ideas without letting throwaway code become production code by accident.
- `engineering/component-inventory` keeps a compact ledger of shared UI
  components, their design-kit references, public inputs, and current usage.
- `engineering/ui-pr-verification` makes UI-impacting PRs carry local
  verification notes and a screenshot of the changed state.
- `engineering/pull-requests` sets the bar for PR scope, descriptions, and
  pre-merge verification so every PR reads well in review the next day.
- `engineering/clean-code` codifies the house standards from the `protocol/`
  TypeScript refactor: file size and folder structure, code reuse, function
  design, naming, comments, and JSDoc on every export.
- `misc/setup-pre-commit` captures the planned local quality gate pattern for
  formatting, typechecking, and tests once `app/` has a package manager and
  scripts.

## Local Intent

These are reference workflows, not product code. When the app is scaffolded,
agents and contributors should use them alongside the Pop Charts design kit and
whitepapers:

- Use the whitepaper vocabulary for domain names: `Virtual LMSR`, `Receipt`,
  `Price band`, `Band-pass clearing`, `Graduation`, `Matched`, and `Refunded`.
- Use design-kit tokens and components as the visual source of truth.
- Keep `app/docs/component-inventory.md` current when shared production UI
  components are created, renamed, removed, or materially changed.
- Record hard-to-reverse frontend decisions as ADRs under `app/docs/adr/`.
- Prefer behavior tests at public interfaces over implementation-detail tests.
