# popcharts

## Quickstart

Use [`mise`](https://mise.jdx.dev/) to install the repo's pinned command-line
tools, then use either `just` or `pnpm` from the repository root.

```bash
mise install
just setup
just dev
```

The same workflow is available without `just`:

```bash
pnpm run setup
pnpm run dev
```

The default dev server is the Next.js app in `app/`. Run `just --list` to see
the full command menu.

## Full Local App Stack

For manual market creation against a local chain and indexer:

```bash
just setup
just local-dev
```

`local-dev` starts docker-compose Postgres, pushes the Drizzle schema, starts a
Hardhat local chain, deploys `MockCollateral` and `PregradManager`, writes
matching ignored env blocks for `server/` and `app/`, starts the Bun API,
starts the indexer, starts the local AI Review service and runner, and starts
the Next.js app. It uses wallet-signed market creation, so connect an injected
browser wallet on the Hardhat local chain. Open `http://127.0.0.1:3000/create`,
create a market, then refresh `http://127.0.0.1:3000/` to see it from the
indexed markets API. The local review service defaults to the heuristic
provider on `http://127.0.0.1:3002`, and the runner polls Postgres for
`under_review` markets. Press Ctrl-C in the `just local-dev` terminal to stop
the API, indexer, app, AI review processes, and local chain. Run
`just local-dev --no-ai-review` if you need the older stack shape temporarily.
Run `just local-reset` to remove the local Postgres container and data volumes
before starting again from an empty database.

### Local Dev Control Plane Spike

For split logs, process restarts, and a dependency graph around the same local
stack, install Process Compose and run:

```bash
brew install f1bonacc1/tap/process-compose
just local-dev-control
```

This spike keeps the current `just local-dev` path intact while adding a
Process Compose-backed control plane. It still uses the repo bootstrap logic:
Postgres starts first, Drizzle constraints and schema push run once, the local
chain becomes healthy, contracts deploy, generated env files are written, and
then the API, indexer, review workers, and Next.js app start as independently
inspectable processes. The TUI shows per-process logs; log files are also
written under ignored `.local-dev/logs/`.

Useful variants:

```bash
just local-dev-control --no-ai-review
just local-dev-control --ai-review-only
just local-dev-control --keep-db
just local-dev-control api
```

After the local chain contracts deploy, create an extra local market with:

```bash
just local-create-market
```

The helper loads the generated `server/.env.local-chain` file before delegating
to the protocol market-creation script, so it uses the current local
`PregradManager` and collateral addresses without manual shell exports. By
default it randomly generates a near-term market from live public sources:

- BTC, ETH, or SOL spot-price markets use the keyless `/simple/price` endpoint
  from `https://api.coingecko.com`.
- NYC, Miami, Los Angeles, or San Francisco temperature markets use the National
  Weather Service hourly forecast for the threshold and the Aviation Weather
  Center METAR API for resolution.

The generated market resolves in two hours, with a one-hour graduation deadline.
Pass `--kind crypto` or `--kind weather` to pick a source family explicitly.
Pass `--preview` to print the generated metadata without creating a market.
The helper emits the canonical JSON metadata payload directly in the
`MarketCreated` event, so the indexer can recover and verify metadata without
an app metadata POST.

## Common Commands

```bash
just setup          # install app and protocol dependencies
just dev            # run the app locally
just local-dev      # run frontend, API, indexer, Postgres, chain, and AI review
just local-dev-control # run the split-log local dev control plane
just local-create-market # create one market against the running local chain
just local-ai-review # run only Postgres, AI Review service, and runner
just local-dev-ai-review # explicit alias for the full AI-review local stack
just local-reset    # clear the local Postgres container and data volumes
just app-check      # app format, lint, typecheck, and unit tests
just devchain-e2e   # local chain deploy plus chain-backed app smoke test
just protocol-check # protocol format, lint, typecheck, and tests
just server-check   # server typecheck and Bun unit tests
just local-smoke    # deploy local protocol, run server/indexer, verify /markets
just check          # app-check, protocol-check, and server-check
just test           # app, protocol, and server tests
just format         # format app and protocol files
just land 12        # merge a PR with scripts/land
```

Root commands delegate into package-local workflows. The app keeps its
`app/pnpm-lock.yaml` for the Vercel project rooted at `app/`, the protocol
keeps its own `protocol/pnpm-lock.yaml`, and the backend server uses Bun from
`server/`.

## Server

`server/` contains the Bun/Elysia API server and viem event indexer. It uses
Drizzle with PostgreSQL and starts with a `PregradManager.MarketCreated`
indexing slice.

```bash
docker compose up -d postgres
cp server/sample.env server/.env
just server-install
cd server && bun run db:push
just server-api
just server-indexer
```

## Devchain Integration

Run a full local app/protocol smoke test with:

```bash
pnpm run devchain:e2e
```

That command starts a local Hardhat chain, deploys the protocol, writes local
app env values, and runs the Playwright `@chain` smoke. See
[`docs/devchain.md`](docs/devchain.md) for Tenderly and Vercel Preview setup.

## Local Chain Server Smoke

For an end-to-end local chain/server smoke, run:

```bash
just setup
just local-smoke
```

The smoke command starts docker-compose Postgres, runs Drizzle push, starts a
local Hardhat node, deploys `MockCollateral` and `PregradManager`, writes
`server/.env.local-chain`, starts the API and indexer with those env values,
creates a market, and polls `GET /markets?chainId=31337` until the indexed
market appears. Pass `--keep-running` to keep the Hardhat node, API, and indexer
alive after verification:

```bash
just local-smoke --keep-running
```

## Engineering Skills

The `skills/` directory is the single skills tree for the repo: vendored
engineering workflows from
[`mattpocock/skills`](https://github.com/mattpocock/skills) (planning with
docs, TDD, diagnosis, architecture review, throwaway prototypes, pre-commit
setup) plus local Pop Charts skills scoped to `app/`, `server/`, and
`protocol/`. See [`skills/README.md`](skills/README.md) for the full list,
upstream provenance pins, and update procedure.

## Developer Helpers

Use `scripts/land` to merge a GitHub pull request, fast-forward the base branch locally, remove the feature worktree, and delete the feature branch.

```bash
scripts/land 12
scripts/land my-feature-branch
scripts/land --squash 12
```
