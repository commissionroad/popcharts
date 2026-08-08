# Nightly verdict-loop scheduled task (reference procedure)

This is the reference procedure for the unattended nightly pass of the ADR
0027 verdict-quality loop. It is a document, not an installation: the
scheduled task itself is created by the user outside this repo (scheduled
tasks are persistent user configuration). Install it only after ~5 clean
attended `/verdict-next` passes.

## Task definition

- **Schedule:** nightly at 05:30 local — one pass per night, done before
  the 8am human day.
- **cwd:** pinned to `/Users/matthewbrown/src/sentilesdal/popcharts` (the
  primary checkout). This matters: the repo's permission allow rules load
  from the session's project directory, so a task launched elsewhere runs
  with none of them and stalls on its first command.
- **Prompt:** "Run one pass of the popcharts verdict-quality loop. Follow
  `skills/engineering/verdict-next/SKILL.md` exactly, plus the unattended
  constraints in `skills/engineering/verdict-next/nightly-task.md`."

## Unattended constraints (on top of the canonical skill)

- Scheduled runs execute in **default permission mode** — settings
  `defaultMode` never applies. Every action must fit an existing allow
  rule; an action the rules do not cover is a pass that stops and reports
  rather than escalates. That is a feature, not a defect.
- Never merge and never enable auto-merge: verdict-loop PRs touch server
  code and eval assets, so human review only.
- Obey the skill's stop conditions unchanged: gate-failed ledger row after
  one fix attempt, two-gate-failed-rows preflight halt, ~90 minute budget,
  `NEEDS-DECISION` question edits.
- Measured runs use the claude-cli provider (a logged-in Claude Code
  install on this machine) on the off-grid ports 3999/3998 per the skill;
  record the spawned PID and `kill` only that PID. If `/ready` is not 200
  within 5 minutes, report `blocked (service not ready)` and stop.

## Allow rules the pass needs beyond the current list

The repo's committed rules cover read/inspect commands and worktree edits.
An unattended pass additionally uses, and will stall without, prefix allow
rules for:

- `Bash(pnpm:*)` — install, `server:check`, `scripts:check`
- `Bash(bun:*)` — the eval runners and `start:ai-resolution` /
  `start:ai-review`
- `Bash(mise:*)` — the `mise exec --` wrapper
- `Bash(kill:*)` — killing the recorded eval-service PID
- `Bash(sleep:*)` — the readiness retry loop
- `Bash(curl http://127.0.0.1:*)` — the `/ready` probe (the stack-control
  guard still blocks control-port URLs regardless)

Adding these to `.claude/settings.local.json` is a user action. Prefer a
broad prefix rule over an exact string — exact strings never match again.

## Report format

Every run reports, success or not. A no-op is one line:

```
verdict-loop: no-op (<reason>) · ticked X of Y items; last 7 ledger rows: <counts by result>
```

Reasons come from the skill's preflight: `waiting for ADR 0027`,
`phase 0 incomplete: <ids>`, `prior PR #N open`, `no eligible items`, or
the halt line `halted (two consecutive gate-failed passes)`.

A pass that shipped leads with: item id and type, result, headline eval
numbers (before/after), PR URL, gate status — then the same health metric
(`ticked X of Y; last 7 ledger rows by result`), read from the ADR Ledger.

## Cleanup

The skill's preflight prunes stale `verdict-loop-*` worktrees and each pass
removes its own; a healthy morning leaves `.worktrees/` free of loop
entries and no stray `start:ai-resolution` / `start:ai-review` process.
