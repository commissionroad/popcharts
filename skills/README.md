# Pop Charts Skills

The single skills tree for the repo. Skills are plain `SKILL.md` documents,
agent-agnostic, and wired into workflows through the `AGENTS.md` files at the
repo root and in `app/`, `server/`, and `protocol/`. There is deliberately no
second tree: protocol- and app-scoped skills live here and declare their scope
in their descriptions.

## Repo-wide

- `engineering/clean-code` — house TypeScript standards from the `protocol/`
  refactor: file size and folder structure, reuse, function design, naming,
  comments, and JSDoc on every export. Applies to all TypeScript in the repo.
- `engineering/pull-requests` — PR scope, description structure, pre-open
  gates, and post-land branch/worktree cleanup (this repo uses merge commits
  and does not auto-delete branches).
- `engineering/grill-with-docs` — interactive plan-grilling against
  `CONTEXT.md` and ADRs before code spreads fuzzy language. Triggered by
  `/grill` (see root `AGENTS.md`).
- `engineering/tdd` — vertical-slice red/green/refactor work, especially for
  LMSR math, receipts, and graduation clearing.
- `engineering/diagnose` — disciplined loop for bugs and regressions:
  reproduce, minimize, hypothesize, instrument, fix, regression-test.
- `engineering/improve-codebase-architecture` — find module-deepening
  opportunities informed by the domain language and ADRs.
- `engineering/prototype` — sanctioned throwaway prototypes (terminal app for
  state/logic questions, multi-variant routes for UI) without letting
  prototype code become production code by accident.
- `misc/setup-pre-commit` — Husky + lint-staged + typecheck/test hooks.
  Already applied in `app/`; use it when adding hooks to workspaces that
  still lack them.

## App (`app/`)

- `engineering/component-inventory` — keep `app/docs/component-inventory.md`
  current when shared components under `app/src/components` change.
- `engineering/ui-pr-verification` — verify UI-impacting changes against the
  real local stack and put verification notes plus a screenshot in the PR.

## Server (`server/`)

- `engineering/server-openapi-sync` — keep the TypeBox route schemas, the
  committed `server/generated/openapi.json`, and the app's orval-generated
  client in sync; regenerate all three surfaces in the same PR.

## Protocol (`protocol/`)

- `engineering/protocol-code-quality` — Solidity/NatSpec, Hardhat 3, viem,
  strict TypeScript boundaries, and naming rules for protocol code.
- `engineering/protocol-deployment-scripts` — deploy entrypoints,
  `protocol/scripts/shared/` helper shape, Hardhat tasks, manifests, and
  Blockscout verification.
- `engineering/protocol-security-audit` — audit the Solidity protocol against
  one catalogued security check (a Trail of Bits building-secure-contracts
  skill, a historical EVM-attack root-cause class, or a peer-protocol audit
  category) end to end and record a finding note. The unit of work the ADR 0023
  audit loop repeats.

## Provenance and updating

Two upstream sources feed this tree; everything else is a local Pop Charts
skill (`clean-code`, `pull-requests`, `component-inventory`,
`ui-pr-verification`, `server-openapi-sync`, `protocol-code-quality`,
`protocol-deployment-scripts`).

### Vendored: [mattpocock/skills](https://github.com/mattpocock/skills) (MIT)

`grill-with-docs`, `tdd`, `diagnose`, `improve-codebase-architecture`,
`prototype`, and `misc/setup-pre-commit` are vendored copies.

- Vendored at commit: `694fa30311e02c2639942308513555e61ee84a6f`
- License: [`LICENSE-MIT-mattpocock-skills`](./LICENSE-MIT-mattpocock-skills)
- Local modifications: `grill-with-docs/ADR-FORMAT.md` is adapted to use the
  nearest context-specific `docs/adr/` directory (e.g. `app/docs/adr/`,
  `protocol/docs/adr/`) instead of a single root `docs/adr/`. Keep that
  adaptation when re-vendoring.

To update: fetch upstream, diff the vendored directories against the pinned
commit, re-copy what changed, re-apply the local ADR-path adaptation, and
update the pin above.

```bash
git clone --depth 50 https://github.com/mattpocock/skills /tmp/mattpocock-skills
git -C /tmp/mattpocock-skills diff 694fa30311e02c2639942308513555e61ee84a6f HEAD -- \
  skills/engineering/grill-with-docs skills/engineering/tdd \
  skills/engineering/diagnose skills/engineering/improve-codebase-architecture \
  skills/engineering/prototype skills/misc/setup-pre-commit
```

### Adapted: [ertugrul-dmr/clean-code-skills](https://github.com/ertugrul-dmr/clean-code-skills) (MIT)

`clean-code` and `protocol-code-quality` adapt the TypeScript track of that
skill set to Pop Charts conventions (Solidity, Hardhat 3, viem, mechanism
language) rather than vendoring it.

- Last reviewed upstream commit: `1b6b3cc1264b8fbe921c65002d05a3bf90ede178`

To update: diff upstream since that commit and port any rule changes worth
keeping into the two adapted skills, then update the pin above.

## Local intent

These are reference workflows, not product code. Use them alongside the Pop
Charts design kit, `CONSTITUTION.md`, `CONTEXT.md`, the ADRs, and whitepaper
v4:

- Use the whitepaper vocabulary for domain names: `Virtual LMSR`, `Receipt`,
  `Price band`, `Band-pass clearing`, `Graduation`, `Matched`, `Refunded`.
- Record hard-to-reverse decisions as ADRs in the nearest `docs/adr/`
  (`app/docs/adr/` for frontend, `protocol/docs/adr/` for protocol).
- Use design-kit tokens and components as the visual source of truth, and
  keep `app/docs/component-inventory.md` current.
- Prefer behavior tests at public interfaces over implementation-detail
  tests; use TDD tracer bullets for LMSR math, receipt accounting, and
  clearing.
- Use diagnose for any failing invariant, flaky test, or confusing revert.
