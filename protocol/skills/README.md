# Pop Charts Protocol Skills

This directory vendors a focused set of engineering skills from
[mattpocock/skills](https://github.com/mattpocock/skills) to guide Pop Charts
protocol work.

Imported from upstream commit:
`694fa30311e02c2639942308513555e61ee84a6f`.

Upstream license: MIT. See
[`LICENSE-MIT-mattpocock-skills`](./LICENSE-MIT-mattpocock-skills).

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
- `misc/setup-pre-commit` captures the planned local quality gate pattern for
  formatting, typechecking, and tests once `app/` has a package manager and
  scripts.

## Protocol Intent

These are reference workflows, not product code. Use them alongside
`../CONSTITUTION.md`, `../CONTEXT.md`, the ADRs, and whitepaper v4:

- Use the whitepaper vocabulary for domain names: `Virtual LMSR`, `Receipt`,
  `Price band`, `Band-pass clearing`, `Graduation`, `Matched`, and `Refunded`.
- Record hard-to-reverse protocol decisions as ADRs under `../docs/adr/`.
- Prefer behavior tests at public interfaces over implementation-detail tests.
- Use TDD tracer bullets for LMSR math, receipt accounting, and clearing.
- Use diagnose for any failing invariant, flaky test, or confusing revert.
