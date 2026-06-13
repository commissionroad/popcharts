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
just check          # app-check and protocol-check
just test           # app unit tests and protocol tests
just format         # format app and protocol files
just land 12        # merge a PR with scripts/land
```

Root commands delegate into the existing package-local workflows. The app keeps
its `app/pnpm-lock.yaml` for the Vercel project rooted at `app/`, and the
protocol keeps its own `protocol/pnpm-lock.yaml`.

## Devchain Integration

Run a full local app/protocol smoke test with:

```bash
pnpm run devchain:e2e
```

That command starts a local Hardhat chain, deploys the protocol, writes local
app env values, and runs the Playwright `@chain` smoke. See
[`docs/devchain.md`](docs/devchain.md) for Tenderly and Vercel Preview setup.

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
