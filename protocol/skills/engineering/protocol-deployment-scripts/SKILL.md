---
name: protocol-deployment-scripts
description: Use when creating, reviewing, or refactoring Pop Charts protocol deployment scripts under protocol/scripts, especially EVM testnet deploy scripts, shared deployment helpers, Hardhat artifacts, viem clients, Blockscout verification, or scripts/shared organization.
---

# Protocol Deployment Scripts

## When To Use

Use this skill for protocol-side deployment script work under `protocol/scripts`.
It applies to new chain deploy entrypoints, shared helper refactors,
Hardhat artifact loading, viem client setup, Blockscout-compatible contract
verification, local manifests, and deployment preflight checks.

## Workflow

1. Read `protocol/AGENTS.md` first and follow its required protocol docs.
2. Keep chain-specific scripts thin. The entrypoint owns network defaults,
   env parsing, contract selection, and manifest shape.
3. Move reusable behavior into `protocol/scripts/shared/`.
4. Run Hardhat-backed commands sequentially. Do not run `pnpm typecheck`,
   `pnpm build`, or deploy scripts in parallel over the same artifact/cache tree.
5. Verify with:

```bash
pnpm --dir protocol format:check
pnpm --dir protocol typecheck
pnpm --dir protocol arc:testnet:deploy-mock
```

The deploy command may intentionally stop at a funded-wallet guard. That is a
valid pre-broadcast check when the deployer has no native gas token.

## Shared Helper Shape

Use one-word category folders under `protocol/scripts/shared/`, and put exactly
one function implementation in each `.mjs` file.

Examples:

- `shared/json/readJson.mjs`
- `shared/chain/defineEvmChain.mjs`
- `shared/viem/createViemClients.mjs`
- `shared/explorer/verifyBlockscoutStandardJson.mjs`

Prefer these categories when they fit: `account`, `artifact`, `chain`, `cli`,
`contract`, `explorer`, `json`, `log`, `time`, and `viem`. If a helper does not
fit, create a new one-word folder.

Add a short comment immediately above every function. The comment should explain
why the helper exists or what guardrail it provides.

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
