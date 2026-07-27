# `just` usage logging

Records which top-level `just` recipes actually get run, so the justfile can be
pruned on evidence instead of guesswork.

## Why

On 2026-07-27 the justfile had 48 recipes, 46 of them thin aliases for a
`pnpm run` script. A scan of shell history, 671 agent transcripts, and every
reference in the repo found that agents essentially never go through `just` —
`pnpm run scripts:check` ran 139 times against 1 for `just scripts-check`, and
`pnpm run format:check` ran 79 times against 0 for `just format-check`. So
`just` usage is human usage, and the only reliable record of it was a shell
history file with no timestamps and a few weeks of depth.

17 recipes with no recorded use anywhere were put in the justfile's
`deprecated` group rather than deleted. They still run; they are marked. This
log decides which of them actually go, and settles the harder cases — recipes
like `check`, `test` and `dev` that are documented in the README command menu
but have no recorded run, where a short history genuinely cannot distinguish
"never used" from "used every few months".

## Install

Put this directory ahead of the real `just` on `PATH`. Prefer `~/.zshenv` over
`~/.zshrc`: `.zshrc` is read only by interactive shells, so agent tool calls
and scripts would go unlogged.

```bash
export PATH="$HOME/src/sentilesdal/popcharts/scripts/just-usage:$PATH"
```

Confirm the shim is in front, and that the real binary still resolves behind
it:

```bash
command -v just && just --version
```

## Read the results

```bash
scripts/just-usage/report
```

Pass a date to limit the window: `scripts/just-usage/report 2026-08-01`.

## Notes

- The log is `~/.popcharts/just-usage.log` (override with
  `POPCHARTS_JUST_USAGE_LOG`), tab-separated: UTC timestamp, `tty`/`no-tty`,
  working directory, arguments. Arguments are themselves separated by US
  (`0x1f`) rather than spaces, so that `just -d "/tmp/a b" test` cannot be
  misread as running a recipe named `b`. The log lives outside the repo on
  purpose — it is personal usage data, not a build artifact.
- A single invocation can run several recipes (`just check test`), and all of
  them are counted. Arguments to a recipe that declares parameters are not:
  `just local-dev test` passes `test` to `local-dev`, so only `local-dev` is
  credited.
- `just --choose` runs an interactively picked recipe, which the log cannot
  identify, so those invocations are skipped rather than guessed at.
- `POPCHARTS_JUST_USAGE=0` disables logging without uninstalling the shim.
- The shim `exec`s the real `just`, so it leaves no extra process in the tree
  and does not interfere with signals or exit codes. The trade-off is that the
  log records invocations, not whether they succeeded.
- Logging is fail-open throughout: if the log cannot be written, the recipe
  still runs.
- CI does not invoke `just` at all (verified across all 7 workflows), so this
  measures local use only. That is the whole population for these recipes.
