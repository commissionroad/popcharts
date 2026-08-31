# ADR 0028: Replace the Hardhat Devchain with an Arc Node Local Chain

Status: Proposed

Date: 2026-08-31

## Context

Every local stack in this repo runs `hardhat node` as its devchain
(`protocol/package.json:49`, `scripts/local-dev-control.ts`,
`local-dev.control-plane.yaml`). We deploy to Arc Testnet (chain 5042002,
USDC as the native gas token). Hardhat's devchain is a generic EVM with ETH
gas and stock EIP-1559 — it cannot tell us anything about the chain we
actually ship to.

Circle publishes `circlefin/arc-node`, whose `scripts/localdev.mjs` runs a
**single** `arc-node-execution` process — no consensus node, no Docker, no
five-node quake testnet. That is a drop-in-shaped replacement for
`hardhat node`, and it runs the real Arc EVM.

Everything below was verified by running the v0.8.0 release binary
(`arc-node-v0.8.0-x86_64-unknown-linux-gnu.tar.gz`, 53 MB) in this
repository's remote dev container on 2026-08-31, not read from docs:

| Probe | Result |
| --- | --- |
| `eth_chainId` | `0x539` (1337) |
| `web3_clientVersion` | `reth/v2.2.0-88505c7/x86_64-unknown-linux-gnu` |
| `eth_blockNumber` (2s apart) | `0x15a` → `0x164` (unaided, ~200ms cadence) |
| `eth_getBalance` `0xf39Fd6…2266` | `0xd3c21bcecceda1000000` (1,000,000) |
| `evm_mine` | `-32601 Method not found` |
| `evm_setNextBlockTimestamp` | `-32601 Method not found` |
| `anvil_setBalance` | `-32601 Method not found` |
| `arc_getVersion` | `-32601 Method not found` |
| `eth_getCode` `0x3600…0000` (native fiat token) | 1799 bytes |
| `eth_getCode` `0xcA11bde05…` (Multicall3) | 3809 bytes |
| `eth_getCode` `0x0000…78BA3` (Permit2) | 9153 bytes |
| `eth_getCode` `0x4e59b448…` (CREATE2 factory) | 70 bytes |

## Decision

Make an Arc node local chain the **only** local chain. Delete the
`hardhat node` devchain path once the stack runs on Arc.

"Only arc-node" scopes to the **chain**, not the toolchain. Hardhat remains
the build, test, and deploy framework — it compiles the contracts, runs
`test solidity` / `test nodejs`, and drives Ignition. What goes away is
`hardhat node` as the JSON-RPC server behind local stacks, and the
`localhost`/31337 network identity built on it.

Deploys and smoke flows port with near-zero work: the localdev genesis
prefunds the standard `test test test … junk` accounts (16 of them, 1,000,000
native each), so `DEFAULT_HARDHAT_PRIVATE_KEY` keeps working unchanged, and
`protocol/scripts/smoke-resolution.ts` has no time-gate dependency at all.

## Gotchas

These are the reasons this is a program and not a one-line URL change.

### G1 — No `evm_*`, `anvil_*`, or `hardhat_*` methods. At all.

Observed as `-32601` above, and structural rather than incidental: arc-node
contains **no `--dev` / `DevArgs` handling in its own crates**. Dev mode is
stock reth v2.2.0, passed straight through, and reth has never shipped
anvil's dev namespace. arc-node is a production node client with a
single-node mode, not a testing chain. This will not arrive in a patch
release.

Confirmed identical at tag v0.6.0 (same launch flags, same chain id, same 16
prefunded accounts, same absence), so it is not a v0.8.0 regression.

Affected call sites:

- `server/src/api/services/local-dev-chain.ts:43` — `evm_setNextBlockTimestamp`
- `server/src/lifecycle-nightly/chain-time.ts:41` — `evm_mine`
- Callers: `dev-market-graduate.ts:720` (challenge deadline),
  `dev-market-resolve.ts:416,448` (resolution gate),
  `pregrad-refund.ts:93` (graduation deadline),
  `lifecycle-nightly/wait.ts:65,88`

### G2 — The `arc` namespace is not wired in single-node dev mode either

`arc_getVersion` returns `-32601` on a `--dev` node, so there is no
Arc-native fallback for G1. The namespace exists in the source
(`crates/evm-node/src/rpc/arc.rs`, exactly two read-only methods:
`getVersion`, `getCertificate`) but is only mounted when a certificate
source — i.e. the consensus layer — is present. Do not plan any local
tooling around `arc_*`.

### G3 — `evm_mine` becomes unnecessary, not merely unavailable

The `mineBlock()` calls exist because "the indexer trails the tip by one
block on an idle chain" (`server/src/lifecycle-nightly/chain-time.ts:36-41`).
At a 200ms cadence the chain is never idle. These calls get **deleted**, not
ported.

### G4 — Time gates move from warps to short real windows

`protocol/scripts/shared/market/localMarketTiming.ts` already exposes
`LOCAL_MARKET_GRADUATION_SECONDS` and `LOCAL_MARKET_RESOLUTION_SECONDS`
(default `7n * DAY_SECONDS`), and `POPCHARTS_DISPUTE_WINDOW_SECONDS` covers
the dispute window (`resolveDisputeConfig.ts:10`). Local flows set these to
tens of seconds and wait real time.

This is a **behaviour change to dev-only endpoints**, and the cost lands on
whoever calls them: `dev-market-graduate` and `dev-market-resolve` currently
return more or less instantly because they warp; afterwards they block for
the real window. Their contract, timeouts, and any UI spinner must be
revisited — this is the single largest piece of work in the migration and
the one most likely to need a design decision rather than a port.

### G5 — The dual-clock drift disappears (a benefit)

`chain-time.ts` documents that on-chain gates read block timestamps while
the AI runners' eligibility compares against wall-clock `new Date()`, so
every warp leaves permanent drift and scenarios must "keep jumps minimal."
On Arc localdev chain time *is* wall time. The two clocks converge and that
class of flakiness is designed out. `resolutionRunnerTimeoutMs`'s
drift-absorbing arithmetic becomes dead weight.

### G6 — Chain id is 1337, not 31337

`scripts/shared/localStack/ports.ts:16` (`BASE_CHAIN_ID = 31337`),
`server/src/config/networks.ts:59` (`chainIdToNetwork`), `networks.ts:101-102`
(viem's `hardhat` chain object), and
`app/src/integrations/wallet/chains.ts:22` (`"Hardhat Local"`) are all keyed
to Hardhat's id. Arc localdev is 1337.

### G7 — Per-slot chain ids become possible, and per-slot datadirs become mandatory

`ports.ts:61` defers per-slot chain ids because "`hardhat node` takes its
chainId from network config, not a CLI flag." arc-node takes
`--chain=<built-in|genesis path>`, so that constraint lifts — ADR 0020's
deferred item is now reachable.

The flip side is enforced: arc-node takes an exclusive lock on its datadir
(observed — a second process died with `storage directory is currently in
use as read-write by another process: PID …`). Every slot needs its own
`--datadir`, or slot N silently refuses to start.

### G8 — The chain is disk-backed, which invalidates the control-plane comment

`local-dev.control-plane.yaml` excludes `chain` from the restart policy
because "the devchain keeps its state in memory, and deploy-contracts does
not re-run, so a restarted chain would come back empty and contractless."
An arc-node datadir persists across restarts, so a restarted chain comes
back **with** its contracts. That comment and the restart exclusion both
need rewriting — and a restart stops being destructive, which is a net
improvement to the stack's failure behaviour.

### G9 — arc-node writes outside the repository

Observed: `Initialized tracing, debug log directory: /root/.cache/reth/logs/dev`.
`arcup` likewise installs to `$HOME/.arc` by default. AGENTS.md forbids
mutating files outside this repository without approval, so every launch
must pin its log directory, datadir, and install prefix inside the repo's
ignored `.local-dev/` tree, and `arcup` must be invoked with `ARC_DIR` set
there (or bypassed entirely in favour of a pinned tarball).

### G10 — Arc's fee market is not stock EIP-1559

From the localdev genesis: `minBaseFee` **20 gwei**, `maxBaseFee` 20000 gwei,
alpha 20%, kRate 2%, inverse elasticity 50%, 30M block gas limit.
`protocol/hardhat.config.ts:66-67` hardcodes `maxFeePerGas: 25 gwei` /
`maxPriorityFeePerGas: 1 gwei` for `arcTestnet` — a 25 gwei ceiling against a
20 gwei floor is thin, and local runs will now actually exercise it.

### G11 — Denylist enforcement is mandatory and chain-derived

As of v0.8.0 the execution-layer denylist is always on and configured from
chain state (`--arc.denylist.enabled` / `--arc.denylist.address` were
removed). Nothing in the Hardhat devchain models this. Deploys and transfers
can now be rejected for reasons the old devchain never produced.

### G12 — Version skew, in the wrong direction

`docs/installation.md` in arc-node — updated in the same commit that synced
v0.8.0 — still lists **Arc Testnet as running v0.6.0**. Running v0.8.0
locally puts local *ahead* of the target network (zero7/zero8 hardforks and
their `CallFrom` / `Multicall3From` precompiles active locally but not on
testnet; a reth 2.2 upgrade that changed insufficient-balance errors to
`OutOfFunds`). **Pin the local version to whatever Arc Testnet runs**, and
treat the pin as a tracked dependency, not a default.

### G13 — Binary acquisition is a new CI and onboarding cost

Building from source is a full reth compile. The practical path is the
release tarball (53 MB, `arc-node-{version}-{target}.tar.gz`, containing
`arc-node-execution`, `arc-node-consensus`, `arc-snapshots`);
`scripts/localdev.mjs` supports it via `--bin=<path>`. CI needs a cached,
checksum-pinned fetch, and `just setup` needs an equivalent.

Published targets (probed at v0.8.0): `x86_64-unknown-linux-gnu`,
`aarch64-unknown-linux-gnu`, `aarch64-apple-darwin` — all `200`.
`x86_64-apple-darwin` is **404**: Intel Macs have no published binary and
would have to build from source. Every archive ships a sibling `.sha256`, so
the pinned fetch verifies rather than trusts; the binary exercised for this
ADR matched its published digest
(`265441e478a91773ecabc293b9824bff27d20afd125d4413481c65613336c933`).

### G14 — Startup is slower and no longer free

`hardhat node` is ready in well under a second with nothing on disk.
arc-node opens an MDBX database and replays a datadir. Stack readiness
probes, `run-local-chain-e2e.ts` timeouts, and CI job budgets all need
re-timing rather than assuming the old latency.

### G15 — The client does not identify as Arc

`web3_clientVersion` returns `reth/v2.2.0-…`, with no Arc marker. Anything
that sniffs client version to branch on "are we local?" must key on chain id
instead.

### G16 — `MockCollateral` versus the native fiat token

The native USDC is a real ERC-20 predeploy at `0x3600…0000` with a
masterMinter/blacklister role set, and localdev genesis hands us the
operator and admin keys. Pointing local collateral at it is a large fidelity
win and costs us free minting in test setup (we would mint through the
operator instead). This is **not** in scope for the migration — it is D2.

## Phases

Each phase is its own PR, green on its own.

### Phase 1 — Runnable Arc chain, alongside Hardhat

Add a pinned, checksum-verified arc-node fetch into `.local-dev/`, a launcher
that pins datadir and log dir inside the repo (G9), and an `arcLocal` Hardhat
network on chain 1337. Nothing is removed. Exit: `local:deploy-pregrad`,
`local:deploy-venue`, `local:deploy-postgrad` and all four `local:smoke-*`
flows pass against arc-node.

This phase alone answers the contract-shape questions that motivated the
work: `PregradManager` code size against EIP-170 on the real Arc EVM (it
sits within 2% of the limit under viaIR per `hardhat.config.ts:22-33`),
CREATE2 hook-address mining for `BoundedPredictionHook`, Permit2 presence
for the v4 venue stack, and deploy gas against the real 30M limit.

### Phase 2 — Slot-aware chain resources

Per-slot datadirs (G7), per-slot chain ids now that they are reachable (G7),
`BASE_CHAIN_ID` retired or parameterised (G6). Update the `ports.ts:61`
comment, which becomes false.

### Phase 3 — Server and app network identity

`chainIdToNetwork`, `createLocalConfig`'s viem chain object, and the app's
`"Hardhat Local"` label (G6, G15).

### Phase 4 — Time-gated flows

Delete `mineBlock` (G3). Replace `fastForwardLocalRpc` with short-window
configuration (G4) across `dev-market-graduate`, `dev-market-resolve`,
`pregrad-refund`, and `lifecycle-nightly`. Retire the drift arithmetic (G5).
**This phase carries the behaviour change and should be reviewed as a design
change, not a port.**

### Phase 5 — Control plane, CI, and removal

Restart policy and its comment (G8), CI chain provisioning (G13), readiness
and timeout re-tuning (G14), then delete `devchain:node`, the `localhost`
network, and the now-misleading `DEFAULT_HARDHAT_PRIVATE_KEY` naming
(the key value is unchanged — arc-node prefunds the same accounts — so this
is a rename, not a key rotation).

## Deferred / open questions

- **D1 — Intel Macs only.** Resolved for Apple Silicon: a pinned
  `aarch64-apple-darwin` archive is published (G13), so the common developer
  machine is covered. `x86_64-apple-darwin` is not published. If anyone on
  the team is on an Intel Mac, decide whether they build from source or keep
  a Hardhat fallback; otherwise close this.
- **D2 — Native fiat token as collateral.** Fidelity win, separate program
  (G16). Not part of this migration.
- **D3 — Which version to pin.** Follows Arc Testnet (G12), so this ADR does
  not name a number; the pin lives in one place and is bumped deliberately.
- **D4 — Do the nightly lifecycle budgets survive real-time windows?**
  Phase 4 turns instant warps into real waits; whether
  `.github/workflows/nightly-lifecycle.yml` still fits its budget is a
  measurement, not an assumption.

## Consequences

We trade an instant, in-memory, ETH-gas devchain for a real-time,
disk-backed chain that runs the EVM, fee market, denylist, and predeploys we
actually deploy onto. Local market lifecycles get slower — real seconds
instead of warps — and in exchange the dual-clock drift that made those
scenarios flaky stops existing, chain restarts stop being destructive, and
contract-shape problems (code size, CREATE2 mining, gas) surface locally
instead of on testnet.

The largest risk is Phase 4: it changes what dev-only endpoints mean, not
just how they are implemented. It should land last and be reviewed as a
design change; every phase before it is reversible by pointing a URL back at
`hardhat node`, and Phase 4 is not.
