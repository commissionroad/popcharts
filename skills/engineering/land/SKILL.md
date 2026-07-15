---
name: land
description: Land a GitHub PR — merge it, update the base branch locally, and clean up the feature branch/worktree — by running the repo's land script.
---

# Land a PR

The single source of truth is the executable: run `scripts/land` from inside
the repository. Do not re-implement its steps by hand with `gh`/`git` — the
script already handles merge, remote/local branch deletion, base-branch
update, worktree removal, and cleanup verification, and it is where fixes to
that procedure belong.

## Invocation

```
scripts/land [PR_NUMBER | PR_URL | BRANCH]   # default: merge commit
```

- Pass the PR number, URL, or branch the user provided. With no argument it
  lands the PR for the current branch (refuses to run from `main`).
- `--squash` / `--rebase` override the merge method; this repo's default is a
  merge commit — do not override unless the user asks.

## Before running

- Confirm the PR's required checks are green (`gh pr checks <n>`) before
  running. The script itself does not enforce checks — GitHub blocks a red
  merge only where branch protection requires it, so do not rely on that.
- The script dies on uncommitted changes in the base or feature worktree —
  resolve those first rather than working around it.

## Agent-driving notes

- Run it from the worktree that has the base branch checked out (the primary
  checkout, normally on `main`) with an explicit PR selector. Running from
  inside the feature worktree works, but the script removes that worktree on
  success, which leaves an agent shell with a deleted cwd — and a checkout
  that has the head branch checked out directly cannot be cleaned up at all.
- The script pulls the base branch (`--ff-only`) in its worktree as part of
  landing — the primary checkout hosts the running local dev stack, which
  picks changes up from there; no extra pull step is needed.
- After landing, confirm the script's final "Done: PR #N landed" line and
  report the merge commit to the user.
