---
name: protocol-deployment-scripts
description: Use when creating, reviewing, or refactoring Pop Charts protocol deployment scripts under protocol/scripts, especially EVM testnet deploy scripts, shared deployment helpers, Hardhat artifacts, viem clients, Blockscout verification, deployment manifests, or scripts/shared organization.
---

# Protocol Deployment Scripts

## When To Use

Use this skill for protocol-side deployment script work under `protocol/scripts`.
It applies to new chain deploy entrypoints, shared helper refactors,
Hardhat artifact loading, viem client setup, Blockscout-compatible contract
verification, local manifests, and deployment preflight checks.

## Workflow

1. Read `protocol/AGENTS.md` and `protocol/skills/engineering/protocol-code-quality/SKILL.md` first.
2. Keep chain-specific scripts thin. The entrypoint owns network defaults,
   env parsing, contract selection, and manifest shape.
3. Move reusable behavior into `protocol/scripts/shared/`.
4. Run Hardhat-backed commands sequentially. Do not run `pnpm typecheck`,
   `pnpm build`, or deploy scripts in parallel over the same artifact/cache tree.
5. For non-broadcast helper or CLI changes, verify the targeted Hardhat task or
   TypeScript entrypoint through its `--help` path, at least one happy path into
   ignored `protocol/cache/`, and one expected error path. Use protocol-local
   `pnpm typecheck` instead of `node --check` for `.ts` files.
6. Verify protocol health with:

```bash
pnpm --dir protocol format:check
pnpm --dir protocol typecheck
pnpm --dir protocol test
```

For broadcast-capable deployment scripts, add the relevant dry-run or preflight
command. `pnpm --dir protocol arc:testnet:deploy-mock` may intentionally stop
at a funded-wallet guard; that is a valid pre-broadcast check when the deployer
has no native gas token.
Use `pnpm --dir protocol arc:testnet:deploy` when the task is to broadcast and
verify the full Arc Testnet protocol surface. Full protocol deploys should use
Hardhat Ignition modules for deployment state and resume/reconcile behavior; keep
chain-specific preflight checks and local manifest writing in a thin Hardhat
script wrapper.

## Shared Helper Shape

Use one-word category folders under `protocol/scripts/shared/`, and put exactly
one function implementation in each helper file. New protocol deployment
scripts, helpers, Hardhat task actions, and tests should be plain `.ts`.
Use `.mjs` only for legacy direct-Node entrypoints that cannot reasonably move
to Hardhat in the same PR, and explain that exception in the PR. Do not add
new `.mts` or `.d.mts` bridge files for fresh TypeScript work.

For operator-facing CLIs, prefer custom Hardhat tasks over hand-rolled
`process.argv` parsing. Task definitions own option names, defaults, and help
text; typed modules own validation, manifest construction, preflight checks, and
chain reads. Package-script options for Hardhat tasks are passed directly, for
example `pnpm --dir protocol deployment:write-venue-manifest --chain-id 31337`;
do not insert a standalone `--` before task options.

Examples:

- `shared/json/jsonFile.ts`
- `shared/deployment/venueManifest.ts`
- `shared/hardhat/assertHardhatNetwork.ts`
- `tasks/venueDeployment.ts`

Prefer these categories when they fit: `account`, `artifact`, `chain`, `cli`,
`contract`, `explorer`, `json`, `log`, `time`, and `viem`. If a helper does not
fit, create a new one-word folder.

Add a short comment immediately above every exported shared helper function.
The comment should explain why the helper exists or what guardrail it provides.
For entrypoint-local helpers, comment only non-obvious invariants, security
constraints, or protocol-specific guardrails.

## Abstraction Rules

Keep helpers chain agnostic. Pass explicit chain names, chain IDs, native
currency metadata, RPC URLs, explorer names, explorer URLs, artifact paths, and
polling options from the entrypoint.

Avoid shallow helpers. If a function only wraps a script-specific object literal
or hides a shape that belongs to one deploy script, inline it in that script.

Keep secrets out of logs. Error messages may name the missing env var, but never
print private key values.

For Blockscout verification, prefer Solidity standard JSON input from Hardhat
build-info instead of flattened source reconstruction.
