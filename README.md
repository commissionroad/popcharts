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

## Common Commands

```bash
just setup          # install app and protocol dependencies
just dev            # run the app locally
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

The `skills/` directory vendors the engineering skills selected for Pop Charts'
frontend buildout. They are adapted from
[`mattpocock/skills`](https://github.com/mattpocock/skills) and cover planning
with docs, TDD, diagnosis, architecture review, throwaway prototypes, and
pre-commit setup.

## Developer Helpers

Use `scripts/land` to merge a GitHub pull request, fast-forward the base branch locally, remove the feature worktree, and delete the feature branch.

```bash
scripts/land 12
scripts/land codex/my-feature
scripts/land --squash 12
```
