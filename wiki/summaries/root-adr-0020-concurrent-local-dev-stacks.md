---
type: summary
title: Repo ADR 0020 — Concurrent local dev stacks
description: Slot-addressed local dev instances (slot 0 human, 1..n agents, then auto-offset) with a home-dir registry, per-slot chain port / DB / env / process-compose admin, identity-scoped chain reuse, and stack-aware create-market — so a second stack no longer silently collides with the first.
sources:
  - docs/adr/0020-concurrent-local-dev-stacks.md
updated: 2026-07-21
---

# Repo ADR 0020: Concurrent Local Dev Stacks

**Status: Accepted — build underway.** Phase 1 (the pure slot/registry core)
landed 2026-07-17; Phases 2–4 (control-plane wiring, database-scoped reset,
stack-aware targeting scripts) follow as their own PRs. Dated 2026-07-17.

## Why

The local stack was built for one instance. Running a second — a human on the
primary checkout plus an agent in `.claude/worktrees/` — silently corrupted
both. A 2026-07-17 incident made it concrete: a leftover
`local:smoke --keep-running` chain stayed bound to `:8545`; a fresh
process-compose stack **adopted the foreign chain** (`chain()` reuses any live
RPC on 8545 without checking whose it is), so it never reset its database, and
a `just local-create-market` market collided with a pre-existing
`(chainId, marketId)` row and never rendered. Four resources were pinned to one
fixed identity: chain RPC `:8545`, the generated env file
`server/.env.local-chain`, the `popcharts` database, and process-compose admin
`:8080`. Only the app-tier HTTP ports were env-overridable, and nothing
coordinated the choice.

## Decision

Local dev stacks become addressable **instances**. Each claims an integer
**slot**; every resource derives from it; a machine-global **registry**
records the running stacks; and targeting scripts resolve through the registry.

Key decisions:

- **Slot 0 = human, 1..n = agents, then auto-offset.** Agent-ness is keyed off
  a `.claude/worktrees/` cwd; `--slot N` / `POPCHARTS_STACK_SLOT` overrides. A
  claimed slot whose ports are occupied advances to the next free slot.
- **Slot 0 is byte-for-byte the legacy defaults** (`:8545`, `popcharts`,
  `.env.local-chain`, `:8080`) — a human running `just local-dev` sees no
  change.
- **Per-slot resources**: chain port `8545 + 10s`, API `3001 + 10s`, app
  `3000 + 10s`, AI review `3002 + 10s`, AI resolution `3004 + 10s`,
  process-compose admin `8080 + s`, database `popcharts` / `popcharts_<s>`, env
  file `.env.local-chain` / `.env.local-chain.<s>`, and indexer health marker
  `.env.local-dev.indexer-health` / `….<s>`. The health marker was the last
  shared-path holdout (every orchestrator deleted and polled one fixed file, so
  concurrent stacks could clear each other's marker or pass readiness against
  the wrong slot's indexer); it became a slot-derived `StackPorts` resource on
  2026-07-21, and `local-chain-smoke` gave up its separate
  `.env.local-chain.indexer-health` filename for the shared slot-scoped one.
- **Isolate at the database, not the container.** Keep the one long-lived
  `popcharts-postgres` container; each slot gets its own database, and reset
  drops/recreates only that database (replacing the old whole-container nuke).
- **chainId stays constant (31337) across slots.** `hardhat node` reads
  chainId from network config, not a CLI flag, and per-slot **database + port**
  isolation already prevents the collision. Per-slot chainId is deferred; it
  matters only for connecting a browser wallet to two stacks at once (a wallet
  keys networks and caches nonces by chainId).
- **Registry in the home directory** (`~/.popcharts/local-stacks/`), because
  each worktree has its own `.local-dev/` and the registry must be
  cross-worktree. Startup prunes dead descriptors (PID + chain-RPC liveness),
  resolves the slot, bind-checks ports, and writes its own descriptor.
- **Fail loudly on a foreign chain.** The identity check replaces silent
  adoption: reuse a chain only when a live registry entry for *this* instance
  owns it.

## Status by phase

**All build phases landed 2026-07-17** (PRs #242, #247, #248).

- **Phase 1 — slot + registry core (#242).**
  `scripts/shared/localStack/{ports,identity,registry,slot}.ts` +
  `assertValidSlot.ts`, unit-tested. Pure; wires nothing into the running
  stack.
- **Phase 2 + 3 — control-plane wiring + database-scoped isolation (#247).**
  `resolveAndRegisterStack` threads the slot through `local-dev-control.ts`
  (and `local-dev.ts` / `local-chain-smoke.ts`), the env builders, and the
  process-compose admin port; silent chain reuse is replaced with the identity
  check (`classifyChainPortOwnership` — a foreign chain fails loudly);
  `ensureLocalPostgres` / `resetLocalPostgresForFreshChain` create and reset
  only the slot's database inside the one shared container. Proven by a real
  two-stack boot (a slot-1 stack alongside a live slot-0, isolated chain/DB/API).
- **Phase 4 — stack-aware create-market (#248).** `resolveTargetStack` selects
  the target from the registry (0 → error, 1 → use, >1 → interactive "which
  stack?" prompt on a TTY, else `--stack <slot|id>` / `POPCHARTS_STACK`);
  wired into `local-create-market`, with explicit `--local-chain-env` /
  `--api-url` still bypassing the registry for back-compat.
- **Phase 5 — cross-workspace targeting scripts (#260).** The `bun`/`hardhat`
  scripts that pick their target from env vars route through one launcher,
  `scripts/with-target-stack.ts`, which resolves the stack (shared
  `resolveTargetStack` + `promptForStack` + `--stack`/`POPCHARTS_STACK`) and
  exports the slot's env superset. `local-bot-trade`, `local-deploy-venue` /
  `-postgrad`, `local-market-health` / `-smoke` are wired through it. Correct
  same-worktree; cross-slot deploy from one checkout still wants the deferred
  per-slot chainId.

## Deferred / future work

A `just local-stacks` status command; scheduled stale-registry GC (vs
prune-on-start only); a port-range-exhaustion policy beyond linear offset;
shared-service dedup for the AI review/resolution services; per-slot chainId;
an explicit `POPCHARTS_STACK_KIND` override if the cwd heuristic misclassifies.

## Related pages

- [Local dev orchestration](../concepts/local-dev-orchestration.md) — the
  stacks and env seams this ADR makes slot-aware.
- [Devchain](../entities/devchain.md) — the per-slot Hardhat chain underneath.
