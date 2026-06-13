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
just protocol-check # protocol format, lint, typecheck, and tests
just server-check   # server typecheck and Bun unit tests
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
