# Protocol security tooling

Phase 0 tooling for the security audit program ([ADR 0023](../../../docs/adr/0023-protocol-security-audit-program.md)).

## Slither

`slither.sh` runs [Slither](https://github.com/crytic/slither) over the
contracts and reports findings scoped to `project/contracts/**` (dependency
noise from Uniswap v4 / OpenZeppelin filtered out).

```sh
protocol/scripts/security/slither.sh                 # summary + High/Medium detail
protocol/scripts/security/slither.sh --json out.json # also write scoped findings as JSON
```

### Requirements

A modern Slither, installed in isolation (does not touch a Homebrew Slither):

```sh
uv tool install slither-analyzer   # provides slither 0.11+ and slither-check-erc/-upgradeability/-prop/-mutate
```

The Homebrew `slither` (0.9.x) is **too old** — it cannot parse file-level
`using … for …`, which the protocol uses (Solidity 0.8.28).

### Why the extra scripts (and not just `slither .`)

Two incompatibilities between the pinned toolchain and Hardhat 3 make the plain
CLI fail; the two helpers work around them:

- **`slither-prepare.mjs`** — `crytic-compile` reads Hardhat **2**-shaped
  build-info (one `{solcVersion, input, output}` file). Hardhat **3** splits it
  into `solc-*.json` + `solc-*.output.json` and uses virtualized source names
  (`project/…`, `npm/pkg@ver/…`). This script reassembles each pair and
  materializes the exact source tree solc saw (from each source's inline
  `content`) under `.slither/` (git-ignored), so crytic-compile resolves every
  unit without renaming anything.
- **`slither-run.py`** — the `slither` **CLI** treats the synthetic tree's
  `project/…` names as out-of-project and reports zero contracts. Driving
  Slither through its Python API analyzes them correctly. The driver runs all
  detectors, scopes results to `project/contracts`, prints a by-impact summary,
  and optionally writes JSON.

Run a **clean** build first (`slither.sh` does this): stale build-info from
mixed compilations causes source-map/content mismatches.

## Fuzzing / invariants

Echidna and Medusa are **not installed** here. Property/invariant tests
(ADR 0023 A10) run as Foundry invariant tests under
`protocol/test/solidity/security/` via `pnpm --dir protocol test:solidity`.
`slither-mutate` (installed with slither-analyzer) covers mutation testing (A11).
