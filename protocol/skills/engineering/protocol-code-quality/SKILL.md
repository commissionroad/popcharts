---
name: protocol-code-quality
description: Use when writing, reviewing, or refactoring Pop Charts protocol code under protocol/, including Solidity contracts, TypeScript or Node scripts/tests, shared helpers, comments, naming, formatting, linting, strict type boundaries, and small cleanup opportunities.
---

# Protocol Code Quality

## Overview

Apply Pop Charts protocol conventions plus the useful parts of the external
TypeScript clean-code skill set. The source inspiration is the MIT-licensed
`ertugrul-dmr/clean-code-skills` TypeScript track, adapted here instead of
copied wholesale so it fits Solidity, Hardhat 3, viem, and Pop Charts mechanism
language.

## Workflow

1. Read `protocol/AGENTS.md` and the required protocol docs before editing.
2. Inspect nearby files first. Prefer the existing module shape, manifest shape,
   naming style, and verification path.
3. Make the requested change, then leave touched code slightly cleaner without
   widening the PR into a refactor sprint.
4. Verify with package-local commands from `protocol/`; do not rely on root
   scripts unless the root already exposes the exact check.

## Names

- Use `CONTEXT.md`, whitepaper, and ADR vocabulary for domain names.
- Do not use third-party company, protocol, or product names in contracts,
  scripts, helpers, manifests, tests, or generated artifacts.
- Choose names that reveal side effects. Prefer `writeVenueManifest`,
  `getOrCreateConfig`, or `collectVenueAddressEntries` over vague verbs.
- Use neutral mechanism names such as `venue`, `completeSet`, `postgrad`,
  `boundedPool`, `receipt`, and `clearing`.
- Replace magic numbers or strings with named constants when the value carries
  protocol meaning.

## Comments

- Solidity requires NatSpec for contracts, events, functions, enums, structs,
  and struct fields. Use `@notice` for protocol semantics and `@dev` for
  implementation constraints.
- TypeScript exported functions, exported types, shared helpers, and generated
  public surfaces should have a short TSDoc or JSDoc comment that explains the
  interface, invariant, or guardrail.
- Local helper comments are optional. Add them for non-obvious accounting,
  security, ordering, cache, artifact, or chain behavior; omit comments that
  merely restate the code.
- Delete stale comments, metadata comments, ticket/date/author comments, and
  commented-out code.

## Types

- Keep `strict` TypeScript on. Do not weaken `tsconfig` for convenience.
- New protocol scripts, script helpers, task actions, tests, and shared
  TypeScript surfaces should be plain `.ts`. The package already uses ESM with
  `type: module` and `moduleResolution: NodeNext`, so `.mts` is unnecessary
  unless a tool explicitly requires it.
- Prefer Hardhat tasks or `hardhat run` for protocol TypeScript entrypoints.
  Do not add Bun as a protocol runner unless the PR demonstrates that Hardhat
  cannot execute the task safely.
- Public TypeScript boundaries need explicit parameter and return types:
  exported functions, exported classes, exported types, test fixtures shared
  across files, and task action inputs.
- Tiny local callbacks and obvious local helpers may use inference when it keeps
  code clearer and the boundary is still typed.
- Avoid `any` at boundaries. Use `unknown` plus narrowing, `Address`,
  `Hash`, literal unions, discriminated unions, branded domain types, or
  explicit manifest types.
- Prefer `satisfies` for object literals that define manifests, config, or
  generated metadata.
- For legacy `.mjs` helpers, prefer converting the touched helper and its
  consumers to `.ts` inside the same slice. Add a focused `.d.mts` declaration
  only when an unchanged legacy direct-Node helper must stay `.mjs` for that PR.

## Modules

- Keep modules deep: small interface, meaningful behavior behind it.
- Extract shared helpers when two scripts or tests need the same rule. Do not
  create pass-through helpers that only rename one line.
- Put reusable script helpers under one-word `protocol/scripts/shared/*`
  categories. Keep entrypoints thin: config, preflight, action, manifest, logs.
- Use Hardhat custom tasks for operator-facing protocol CLIs when the command
  needs typed options, environment defaults, or shared task help. Keep task
  actions thin and delegate behavior to typed modules.
- Make temporal coupling explicit: build before artifact reads, assert chain
  before broadcast, verify bytecode before trusting manifests.

## Formatting And Linting

- Prettier owns formatting. Run `pnpm --dir protocol format` or
  `pnpm --dir protocol format:check`; do not hand-format around Prettier.
- Solhint owns Solidity linting. Run `pnpm --dir protocol lint:sol`.
- TypeScript strict mode is currently the main TypeScript static gate. If adding
  ESLint later, use flat config with `@typescript-eslint`, keep it scoped to
  TypeScript/JavaScript files, avoid Prettier-overlapping style rules, and start
  with rules that protect boundaries: no explicit `any`, no floating promises,
  no unused vars, consistent type imports, and explicit return types for
  exported/shared functions.

## Tests

- Test behavior through public interfaces. Avoid tests that only lock in private
  helper shapes.
- Add boundary tests near parser, math, rounding, chain, manifest, and role
  logic. Bugs cluster at invalid inputs and off-by-one ranges.
- Do not leave `test.only`, `it.only`, or unexplained skipped tests.
- For script helpers, include at least one happy path and one expected error
  path before relying on the helper from a deployment entrypoint.

## Review Checklist

- No duplicated protocol rule in two places without a shared helper or constant.
- No ambiguous names, hidden side effects, or third-party implementation names.
- Public/exported boundaries are typed and commented.
- Comments explain why, invariant, or protocol meaning, not obvious mechanics.
- Prettier, Solhint, TypeScript, and targeted tests match the files touched.
