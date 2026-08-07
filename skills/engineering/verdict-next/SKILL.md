---
name: verdict-next
description: Use when driving one pass of the ADR 0027 AI-verdict-quality loop — select the first eligible unchecked catalogue item (measurement, dataset, red-team, prompt, or meta), execute its item-type playbook against the review/resolution eval harnesses, measure with --runs 3 minimum where the type requires it, and ship exactly one small verdict-loop PR that also ticks the catalogue box and appends the ledger row. This is the unit of work the verdict-quality loop repeats.
---

# Verdict Quality Loop (one item per pass)

## Overview

One pass = one catalogue item = one PR labelled `verdict-loop`. The
catalogue is `docs/adr/0027-verdict-quality-loop.md` — always that exact
filename, never a glob. The loop calls this skill repeatedly. **Do not
batch items.** Depth per item is the point; a pass that "quickly clears"
five items has skimmed all five.

A measured no-change is a first-class result. "The prompt change did not
beat baseline, here are the numbers, iteration recorded and rejected" is a
shipped pass, not a failed one.

In scope: both verdict services. Review evals live in
`server/src/ai-review/evals/`, resolution evals in
`server/src/ai-resolution/evals/`; the taxonomy and label policy live in
`docs/ai-verdict-failure-taxonomy.md`. Read the relevant evals README
before any measured run — it is the single source for env knobs and
provider facts.

Catalogue shape this skill expects (the ADR matches): each item is one
`- [ ]` line with an id (`A1`, `D4`, ...), a type tag (`[measurement]`,
`[dataset]`, `[red-team]`, `[prompt]`, or `[meta]`), and optionally
`DEPENDS(<id>)` / `BLOCKED(<reason>)` eligibility tags; Phase 0 renders as
bold `status:` lines, not checkboxes; the ADR ends with an append-only
`## Ledger` table, newest row last. The Ledger is the loop's only
cross-pass memory — nothing else carries state between passes.

## Preflight (in order, from the primary checkout, BEFORE any worktree)

Every no-op check happens before a worktree exists; a no-op pass touches
nothing.

1. `git fetch origin`.
2. If `docs/adr/0027-verdict-quality-loop.md` does not exist on
   origin/main, report `no-op (waiting for ADR 0027)` and stop.
3. Read the ADR's Phase 0 section. If any `P0.*` status line is not marked
   `landed`, report `no-op (phase 0 incomplete: <ids>)` and stop.
4. Read the last two Ledger rows. If both are gate-failed, halt: report
   `halted (two consecutive gate-failed passes)` and wait for the user. Do
   not retry past two.
5. Idempotence: `gh pr list --state open --label verdict-loop`. If a PR is
   open, do NOT spam it: compare its current CI state against the last
   loop-authored status comment, comment only if the CI state changed, and
   report `no-op (prior PR #N open)` either way. One in-flight loop PR at a
   time.
6. Prune stale loop worktrees: remove any `.worktrees/verdict-loop-*`
   worktree left by a previous pass (`git worktree list`, then
   `git worktree remove`, `--force` only for aborted ones), then
   `git worktree prune`.
7. Select the item (below). If no item is eligible, report
   `no-op (no eligible items)` and stop.
8. Only now create the worktree:
   `git worktree add .worktrees/verdict-loop-<item-id>-<hhmm> --detach origin/main`
   (`<hhmm>` = current wall-clock hour+minute). Do all work there; remove
   it when the pass ends. Note the start time — the pass has a ~90 minute
   budget.

## Select the item

An explicit item id argument wins (even a `BLOCKED` one — the user asked).
Otherwise walk sections A → B → C → D → E → M and take the first unchecked
`- [ ]` box that is **eligible**:

- `DEPENDS(<id>)` — eligible only when the named item's box is ticked; a
  `P0-*` id is satisfied when its Phase-0 line says `landed`.
- `BLOCKED(<reason>)` — never eligible; only the user removes the tag.

Skip ineligible items to the next eligible one. If every box is ticked,
report the catalogue complete and stop. Then, in the worktree,
`git switch -c verdict-loop/<item-id-lowercase>`.

## Item-type playbooks

**[measurement]** — build or verify measurement tooling (runner flags,
metrics, report shape, regression checks). Prove the tool on a real bounded
run (`--limit`) and paste the observed output into the PR body. Never edit
dataset cases, prompts, or baselines in the same pass (exception: an
explicit rebaseline item like A5, which ships baselines alone).

**[dataset]** — add at least 3 labeled cases to ONE taxonomy class, each
with a one-line rationale, matching the dataset types and the label policy.
Second-model label check: have an independent second model label each new
case blind (case text only, no expected label); record the agreement in the
PR body; on disagreement, park the case for the user, unlabeled. Never
touch prompts or baselines.

**[red-team]** — measure current behaviour against the named attack class
and record numbers plus a transcript summary. "Not exploitable, and here is
the guard that blocked it" is a first-class result. Fixes become follow-up
catalogue items; this pass records, it does not patch.

**[prompt]** — change ONE thing. Measure before AND after on the same
dataset slice, same provider, same `--runs`. Adopt or reject on the numbers
only. A rejected iteration is recorded in the relevant evals README
"Measured iterations" section so it is never retraced. A baseline moved by
the change ships in the same PR; dataset changes never do.

**[meta]** — a defect of the loop itself (playbook gap, tooling trap,
misleading instruction). Fix the loop artifact the item names. A meta item
may NOT change the ADR's Guardrails or this skill's Hard prohibitions; the
most it may do is add a `NEEDS-DECISION:` question edit for the user.

## Measurement rules

- `--runs 3` minimum, always. Never single-run: the resolution evals README
  postmortem shows single-run smokes report the opposite of the 3-run
  truth.
- Graded runs use the `claude-cli` provider under subscription auth; ollama
  is plumbing only (README, 2026-07-23 baseline decision).
- Runs carrying the `service_error` hard flag count as errors, not
  outcomes.
- The runner never starts a service. Start the one you need yourself, on
  the **off-grid eval ports** — NEVER 3004 or 3002, which belong to the
  slot-0 user stack (the stack-control guard does not cover service ports;
  a silent bind failure leaves `/ready` answering from the USER's service,
  and the eval measures — or kills — the wrong process):

  Resolution service (from `server/`):

  ```sh
  AI_RESOLUTION_PORT=3999 AI_RESOLUTION_PROVIDER=claude-cli \
  AI_RESOLUTION_TIMEOUT_MS=300000 \
    bun run start:ai-resolution &
  echo $!   # record this PID
  curl http://127.0.0.1:3999/ready   # 503 until ready; retry with sleep
  ```

  Review service (from `server/`):

  ```sh
  AI_REVIEW_PORT=3998 AI_REVIEW_PROVIDER=claude-cli \
    bun run start:ai-review &
  echo $!   # record this PID
  curl http://127.0.0.1:3998/ready
  ```

  Pass the matching `--service-url` (`http://127.0.0.1:3999` /
  `http://127.0.0.1:3998`) to the eval runner. Before the pass ends,
  `kill <recorded-PID>` — kill ONLY that PID, never a pattern match.

- Reports land in `server/eval-reports/` (gitignored); copy the headline
  numbers into the Ledger row and PR body.

## Gate

- Server files touched → `pnpm run server:check` (repo root). Scripts →
  `pnpm run scripts:check`. Docs-only pass → no gate.
- A red gate gets one fix attempt. Still red → do not ship the item:
  discard the item changes and instead ship a **docs-only PR** appending a
  gate-failed Ledger row (notes = the failing gate and one-line cause).
  Preflight's two-row halt is what stops a broken loop from thrashing.

## Ship

- Branch `verdict-loop/<item-id-lowercase>`. ONE commit:
  `verdict(0027): <ID> <short summary>`.
- The same commit ticks the catalogue box and appends ONE Ledger row:
  `| <YYYY-MM-DD> | <ID> | <type> | <before or —> | <after or —> | #<n> | <result: shipped / rejected-iteration / not-applicable / gate-failed; one line> |`
- Push, then `gh pr create --label verdict-loop`. If the label is missing
  on the repo, fail loudly and report — do not ship unlabelled (the label
  is the idempotence key). The PR body states: item id and type, what
  changed, before/after numbers where measured, the hand-written line
  count, and every load-bearing claim tagged
  observed / read / inferred / assumed.
- Never merge. The PR waits for human review. Remove the pass worktree.

## Stop conditions

- Gate still red after one fix attempt (ship the gate-failed row, above).
- ~90 minutes wall clock: ship a complete smaller slice of the item if one
  exists; otherwise stop with a blocked report and leave no worktree
  behind.
- The item needs a user decision: write the question into the catalogue
  item text as `NEEDS-DECISION: <question>`, leave the box unticked, ship
  that edit plus the Ledger row as this pass's PR, and stop.

## Retro

One Ledger row per pass, always. If the pass exposed a loop defect, append
a new `[meta]` item to the catalogue's M section in the same PR.

## Hard prohibitions

- Never read the evals holdout directories
  (`server/src/ai-review/evals/holdout/`,
  `server/src/ai-resolution/evals/holdout/`). The committed
  `.claude/settings.json` denies Read on both paths; a denial there means
  the pass was about to break the guardrail — stop, do not route around
  it. A peeked holdout is unrecoverable.
- Never modify files under `evals/baselines/` outside an explicit
  rebaseline item (A5) or the prompt change that moved them. Baselines
  change only as reviewed diffs and are never merge gates.
- Never touch dataset + prompt in one PR, in any combination with
  baselines.
- Never merge anything; never run `scripts/land`.
- Never bind or address ports 3004/3002 (user-stack service ports) or 8080
  and the 8080+10k control grid. The PreToolUse guard
  (`scripts/guard-stack-control.ts`) blocks control ports; a guard block
  means the command was wrong — re-scope or stop, do not fight it.
- No third-party company or product names in any identifier, filename, or
  branch name.

## Conventions

- Server workspace files are kebab-case.
- Cite code as `server/src/<path>:<line>`.
- If an item touches resolver gates, chain proposal, or finalize seams
  (money path), its tests must fail if the wiring is reverted, and the PR
  body flags it for human review explicitly.
- Resolution supporting-row reads respect the ADR 0026 `commit_state`
  reader rule: only confirmed rows are real resolutions.
