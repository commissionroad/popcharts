# ADR 0020: Concurrent Local Dev Stacks

Status: Accepted

Date: 2026-07-17

## Context

The local dev stack was built for one instance at a time. Running a second
stack — a human on the primary checkout plus one or more agents in
`.claude/worktrees/` — silently corrupts both, with no error at any layer.
A 2026-07-17 incident made this concrete: a leftover
`local:smoke --keep-running` chain from one worktree was still bound to
`:8545` when a process-compose stack started on the primary checkout. The new
stack adopted the foreign chain, never reset its database, and a
`just local-create-market` market collided with a pre-existing
`(chainId, marketId)` row and never appeared in the UI.

The root cause is that four resources are pinned to a single fixed identity,
so a second stack lands on top of the first:

- **Chain RPC `:8545`** — hardcoded in `scripts/local-dev-control.ts`
  (`rpcPort = "8545"`) and `scripts/shared/env/buildLocalServerEnv.ts`
  (`RPC_HTTP_URL`). Not parameterizable.
- **Generated env file** `server/.env.local-chain` — a single fixed path
  (`scripts/shared/env/localDevEnvFiles.ts`) that every stack overwrites.
- **Postgres database** `:5433/popcharts` — one shared container
  (`popcharts-postgres`) and one database, reused across worktrees by design.
  `resetLocalPostgresForFreshChain` removes the whole container and its
  volumes, so a per-stack reset wipes every stack's data.
- **process-compose admin `:8080`** — hardcoded.

Only the app-tier HTTP ports (`LOCAL_API_PORT` 3001, `LOCAL_APP_PORT` 3000,
`LOCAL_AI_REVIEW_PORT` 3002, `LOCAL_AI_RESOLUTION_PORT` 3004) are already
env-overridable; nothing else is, and nothing coordinates the choice.

Two mechanisms turn the collision silent:

1. `chain()` and `prepareDatabase()` reuse *any* live RPC on `:8545`
   (`isRpcReady`) without checking whose it is — intended for reattaching to a
   node the same orchestrator started, but it adopts a foreign chain just as
   readily and skips the DB reset when it does.
2. `local-create-market` (and its siblings) read a single fixed env file and
   resolve the API from `LOCAL_API_PORT`/`PORT`/default 3001. There is no
   notion of "which stack," so they target whatever last wrote the file.

## Decision

Make local dev stacks first-class, addressable **instances** that can run
concurrently without coordination. Every stack claims an integer **slot**;
all of its resources derive from that slot; a machine-global **registry**
records the running stacks; and the stack-targeting scripts resolve their
target through that registry, prompting when more than one is running.

Scoping decisions (2026-07-17 grill):

- **Slot 0 is reserved for humans; slots 1..n are for agents; then
  auto-offset.** Agent-ness is keyed off the working directory: a stack whose
  cwd is under `.claude/worktrees/` is an agent and claims the lowest free
  slot ≥ 1; otherwise it is the human default, slot 0. An explicit
  `--slot N` / `POPCHARTS_STACK_SLOT` always wins. If a claimed slot's ports
  are occupied by a live foreign process, advance to the next free slot
  rather than adopting it.
- **Slot 0 is byte-for-byte the legacy defaults.** DB `popcharts`, env file
  `.env.local-chain`, chain `:8545`, chainId `31337`, admin `:8080`. A human
  running `just local-dev` from the primary checkout sees no change.
- **Isolate at the database, not the container.** Keep the single
  long-lived `popcharts-postgres` container; give each slot its own database
  (`popcharts` for slot 0, `popcharts_<slot>` otherwise). Reset drops and
  recreates only the slot's database.
- **chainId stays constant (31337) across slots.** Per-slot chainId was
  considered (it would have independently prevented the incident) but
  `hardhat node` reads its chainId from network config, not a CLI flag, and
  the repo's Hardhat config has no env-driven chainId hook — only a
  `POPCHARTS_LOCAL_RPC_URL` port override. Wiring a real per-slot chainId
  requires verifying Hardhat 3 EDR-node behavior, and a `chainId` the live
  chain does not actually report would break downstream queries. Per-slot
  **database + port** isolation already fully prevents the collision (slot 1's
  markets live in `popcharts_1`), so per-slot chainId is redundant and is
  deferred (see Deferred / future work).
- **Registry lives in the home directory** (`~/.popcharts/local-stacks/`),
  because each worktree has its own `.local-dev/` and the registry must be
  visible across all of them. This is the one place the stack writes outside
  the repo; approved for this tool's own state.
- **Always fail loudly on a foreign chain.** The identity check replaces the
  silent-adoption path entirely: reuse a chain only when a live registry
  entry for *this* instance owns it.

### Mechanism: slot → resources

Given slot `s`:

| Resource | Formula | slot 0 | slot 1 |
| --- | --- | --- | --- |
| Chain RPC port | `8545 + 10s` | 8545 | 8555 |
| chainId | `31337` (constant; see above) | 31337 | 31337 |
| API port | `3001 + 10s` | 3001 | 3011 |
| App port | `3000 + 10s` | 3000 | 3010 |
| AI review port | `3002 + 10s` | 3002 | 3012 |
| AI resolution port | `3004 + 10s` | 3004 | 3014 |
| process-compose admin | `8080 + s` | 8080 | 8081 |
| Postgres database | `popcharts` / `popcharts_<s>` | popcharts | popcharts_1 |
| Env file | `.env.local-chain` / `.env.local-chain.<s>` | (legacy) | .env.local-chain.1 |

### Mechanism: the registry

`~/.popcharts/local-stacks/<instanceId>.json`, one descriptor per running
stack:

```
{ instanceId, slot, kind: "human" | "agent", worktreePath,
  chainPort, chainId, apiPort, appPort, reviewPort, resolutionPort,
  pcAdminPort, dbName, envFile, deployAddressesPath,
  controlPid, startedAt }
```

Startup sequence: load all descriptors → **prune dead** (control PID gone, or
chain port silent) → resolve slot (explicit flag, else cwd heuristic) →
**bind-check** every derived port and advance the slot on any conflict →
write this instance's descriptor → best-effort remove it on exit. Crash
cleanup is covered by prune-on-next-start, so a hard-killed stack never blocks
a slot permanently.

### Mechanism: stack-aware scripts

`local-create-market` and every sibling that targets a running stack
(`local-bot-trade`, `local-smoke`, `local-dev-ai-review`,
`local-deploy-venue`, and the postgrad helpers) resolve their target from the
registry:

- **0 stacks** → clear error ("no local stack running; start one with
  `just local-dev`").
- **1 stack** → use it (unchanged behavior).
- **>1 stacks** → interactive "which stack?" prompt listing slot / kind /
  worktree / ports on a TTY; otherwise require `--stack <id|slot>` or
  `POPCHARTS_STACK`.

The chosen descriptor supplies the env file and ports, replacing the fixed
`localChainEnvFile` + `LOCAL_API_PORT` lookup.

## Phases

One concern per PR; this checklist is updated in the same PR as the work
(the ADR 0016/0017 model).

### Phase 1 — slot + registry core

- [x] `scripts/shared/localStack/slot.ts` — slot resolution (explicit flag →
      cwd-under-`.claude/worktrees/` agent heuristic → human slot 0), with the
      foreign-port advance rule.
- [x] `scripts/shared/localStack/ports.ts` — the slot → ports/chainId/dbName/
      env-file derivation table above, single source of truth.
- [x] `scripts/shared/localStack/registry.ts` — read/write/prune descriptors
      under `~/.popcharts/local-stacks/`, liveness check (PID + port).
- [x] `scripts/shared/localStack/identity.ts` — human/agent kind + instance id
      from cwd.
- [x] Unit tests for slot resolution, port derivation, identity, and prune
      logic (`scripts/test/local-stack-*.test.ts`, all green).

Phase 1 landed 2026-07-17; 66/66 `scripts:test` pass. Carried into Phase 2:
`isDescriptorAlive` requires PID-alive **and** chain-RPC-ready, so a stack
mid-boot (chain still deploying) reads as dead. Phase 2 must write the
descriptor at the right moment and make prune tolerate a booting stack (e.g. a
short grace window or a "starting" state) so a booting stack's slot is not
reclaimed out from under it.

### Phase 2 — wire the slot through the control plane

- [x] `local-dev-control.ts`: derive chain port, admin port, and env from the
      resolved slot; write and remove the registry descriptor around the run.
- [x] Replace silent RPC reuse in `chain()` / `prepareDatabase()` with the
      identity check (reuse only this instance's chain; fail loudly on a
      foreign one).
- [x] `buildLocalServerEnv.ts`, `localDevEnvFiles.ts`,
      `resolveIndexerApiBaseUrl.ts`: slot-scoped RPC URL, DB URL, ports, and
      env-file path.
- [x] AI review / resolution endpoint helpers: slot offset.
- [x] `local-dev.control-plane.yaml` and any port references it carries.
- [x] All three local orchestrators (`local-dev-control.ts`, `local-dev.ts`,
      and `local-chain-smoke.ts`) resolve and register a slot through the shared
      `resolveAndRegisterStack` helper before starting their children.
- [x] **Collapse the duplicated coordination constants.** `ports.ts` is the
      single source of truth: every orchestrator and env/endpoint/database
      helper now consumes resolved `StackPorts` (or the slot-derived env), so
      the work is full slot-awareness rather than merely sourcing slot-0
      constants from one file.

### Phase 3 — database-scoped isolation

- [x] `ensureLocalPostgres.ts`: ensure the slot's database exists inside the
      shared container.
- [x] `resetLocalPostgresForFreshChain.ts`: drop/recreate only the slot's
      database; never remove the container or its volumes.

Phases 2 and 3 were implemented together on 2026-07-17 so the control plane
never points a derived slot at the legacy shared database-reset behavior.

### Phase 4 — stack-aware scripts

- [ ] `local-create-market.ts`: registry resolution + interactive prompt +
      `--stack` / `POPCHARTS_STACK`.
- [ ] Apply the same resolution to the sibling scripts
      (`local-bot-trade`, `local-smoke`, `local-dev-ai-review`,
      `local-deploy-venue`, postgrad helpers).
- [ ] `just` recipe help text documents multi-stack usage.

### Verification

- [ ] Launch a slot-1 stack from a worktree alongside a live slot-0 human
      stack; confirm isolated chain, DB, API, and app.
- [ ] `just local-create-market` against each stack lands the market in that
      stack's UI only.
- [ ] Kill a stack ungracefully; confirm the next startup prunes it and
      reclaims the slot.

## Deferred / future work

- [ ] **Per-slot chainId** (`31337 + slot`), for defense-in-depth even if two
      slots ever shared a database. Requires an env-driven `networks.hardhat`
      chainId in `protocol/hardhat.config.ts` and confirming Hardhat 3's
      EDR `node` honors it; `ports.ts` would then return `BASE_CHAIN_ID + slot`
      instead of the constant. Deferred because per-slot DB + port isolation
      already prevents the collision this would guard against.
- [ ] **A `just local-stacks` / `local-dev-control status` command** that
      lists running stacks and their ports from the registry (nice-to-have;
      the registry files are readable directly in the interim).
- [ ] **Stale-registry GC on a schedule** rather than only prune-on-start, if
      long-lived orphans become a problem in practice.
- [ ] **Port-range exhaustion policy** beyond linear auto-offset (unlikely to
      matter below ~10 concurrent stacks; revisit only if hit).
- [ ] **Shared-service dedup** — if the AI review/resolution services are
      safe to share across slots, a future change could run one and save
      ports; deferred because per-slot isolation is the safer default now.
- [ ] **Explicit `POPCHARTS_STACK_KIND` override** if the cwd heuristic ever
      misclassifies (e.g. an agent working outside `.claude/worktrees/`).

## Exit criteria

Two stacks (human slot 0, agent slot 1) run concurrently with fully isolated
chain, database, env, and HTTP surfaces; `local-create-market` targets a
chosen stack and its market appears only there; a foreign process on a slot's
ports produces a loud error or a clean advance to the next slot, never silent
adoption; and slot 0 with no flags reproduces today's single-stack behavior
byte-for-byte.

## Consequences

The local dev orchestration gains an instance/slot/registry layer and a small
amount of home-directory state. Slot 0 remains the zero-config default, so
existing human workflows and the `just` recipes are unchanged. Agents in
worktrees get first-class concurrent stacks instead of silent collisions, and
the class of failure in the 2026-07-17 incident becomes impossible: a foreign
chain is detected, not adopted, and each stack's data lives in its own
database. The `wiki/concepts/local-dev-orchestration.md` page is updated to
describe the slot model.
