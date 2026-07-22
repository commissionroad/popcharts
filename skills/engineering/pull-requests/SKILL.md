---
name: pull-requests
description: Guidelines for scoping, describing, and verifying pull requests in this repo. Use when creating a PR, splitting a large change into PRs, or reviewing whether a branch is ready to land.
---

# Pull Requests

A PR is the unit of review. Optimize it for a reviewer reading it tomorrow with
no memory of the session that produced it.

## Scope: one logical change

- One PR = one reviewable idea. "Convert scripts/ to TypeScript" and "fix the
  OpenAPI schema names" are two PRs, even if you did them in one sitting.
- Never mix **mechanical** changes (renames, moves, formatting, codegen output)
  with **behavioral** changes in the same commit. Ideally not in the same PR;
  when unavoidable, separate commits so the reviewer can skim the mechanical
  one and read the behavioral one.
- **Hard cap: 500 lines of hand-written diff.** Aim for a few hundred; past
  500, split it — or, if the change is genuinely atomic and cannot be cut,
  justify why in the description. Mechanical/generated output (codegen,
  migration snapshots, lockfiles) does not count toward the cap, but say so and
  point at the small hand-written core so the reviewer skips it.
- Dependent changes stack: land the prerequisite PR first, branch the next one
  from it. Don't hold a mega-branch open.

## Description

Structure the body as:

- **Summary** — 2–5 sentences: what changed and *why now*. Lead with the
  user-visible or reviewer-relevant outcome, not the file list.
- **Changes** — grouped bullets, ordered by review importance. Flag anything
  mechanical ("all 40 files under `generated/` are regenerated output").
- **Verification** — the exact commands run and their outcomes (test counts,
  not "tests pass"). If something was verified end-to-end (devchain run,
  screenshot), say how. If something is *not* verified (e.g. broadcast-ready
  but only dry-run), say that too.

Call out follow-ups you deliberately deferred so the reviewer knows omission
was a choice, not an oversight.

## Before opening

- Run the repo gates for every workspace you touched: `pnpm format:check`,
  `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` (or the workspace
  equivalents / `just` recipes).
- Re-read the full diff (`git diff main...HEAD`) once, as the reviewer:
  leftover debug output, stray files, comments that narrate the session
  instead of the code — all removed.
- Commits are atomic and messages describe the change, not the process
  ("Convert explorer helpers to TypeScript", not "fixes" / "wip").

## UI-impacting PRs

Follow `engineering/ui-pr-verification`: include local verification notes and
a screenshot of the changed state.

## After landing

Landing a PR is not done until the branches are cleaned up and the local main
checkout is current. The repo does not auto-delete branches on merge.

- Prefer `scripts/land` (the `/land` command). It merges, deletes the remote
  branch, removes the feature worktree, deletes the local branch, and verifies
  all of that — the manual steps below are only for when you cannot use it.
- Do NOT rely on `gh pr merge --delete-branch` to remove the *local* branch:
  `gh` must switch off the branch to delete it, and from a linked worktree it
  cannot (`main` is checked out elsewhere), so the remote is deleted while the
  local branch silently survives. Merge, then delete the local branch yourself.
- Delete the local branch. If it is checked out in a worktree, remove the
  worktree first (`git worktree remove <path>` — never `--force`; a refusal
  means uncommitted work that must be looked at, not discarded), then
  `git branch -d <branch>`. From inside the worktree itself, `git checkout
  --detach` before `git branch -d`.
- The harness creates each worktree on a throwaway `claude/<name>` branch; a
  session usually lands a *different* feature branch, so the scratch branch is
  merged into main only as an ancestor and never has its own PR. `land` won't
  catch these — sweep them with `git branch --merged origin/main`.
- Sweep other fully-merged branches while you are here
  (`git branch --merged origin/main`), using the same non-forcing commands.
  Leave unmerged branches and other agents' in-flight worktrees alone.
- Update the primary checkout: `git -C <repo-root> pull --ff-only` on `main`.
  Local services (process-compose / `just local-dev`) run from the primary
  checkout, so until it is pulled, restarting them serves the pre-merge code.
