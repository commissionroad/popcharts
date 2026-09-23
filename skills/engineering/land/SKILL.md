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

The one sanctioned exception is an environment that cannot reach the GitHub
API at all, where the script physically cannot make those calls. Even there
you do not re-implement the cleanup: you make only the GitHub calls yourself
and hand the results back via `--pr-json`, so the git-side procedure still
runs from this one script. See "Environments without gh" below.

## Invocation

```
scripts/land [PR_NUMBER | PR_URL | BRANCH]   # default: merge commit
scripts/land --pr-json FILE                  # environments with no GitHub API
```

- Pass the PR number, URL, or branch the user provided. With no argument it
  lands the PR for the current branch (refuses to run from `main`).
- `--squash` / `--rebase` override the merge method; this repo's default is a
  merge commit — do not override unless the user asks.

## Before running

- Confirm the PR's required checks are green before running — `gh pr checks <n>`
  where gh exists, otherwise read the check runs through whatever GitHub API
  access you have. The script itself does not enforce checks — GitHub blocks a
  red merge only where branch protection requires it, so do not rely on that.
- The script dies on uncommitted changes in the base or feature worktree —
  resolve those first rather than working around it.

## Environments without gh (Claude Code cloud sessions)

A cloud session has no `gh` and **cannot reach `api.github.com` at all** — the
proxy refuses it with or without a token, because GitHub access there is
routed through the GitHub MCP tools rather than the session's network. So the
script cannot perform the GitHub half itself, and no amount of credentials
changes that. Do not try to install `gh` or curl the API.

What it can still do is everything else, which is most of what it guarantees:
remote branch deletion (with its postcondition check), base-branch update,
worktree removal, local branch deletion, and cleanup verification. Run the
GitHub calls yourself and hand the results to the script, so that cleanup
still comes from one implementation instead of being improvised:

1. Read the PR's `number`, `state`, `headRefName`, `baseRefName`, `url`, and
   `isCrossRepository`.
2. Merge it (merge commit unless the user asked otherwise) and read back the
   merge commit oid.
3. **List OPEN PRs whose base is this PR's head branch, and retarget each onto
   this PR's base.** Not optional: GitHub closes any open PR whose base branch
   is deleted and then refuses to reopen it, so the work has to be re-submitted
   as a new PR.
4. Write the facts to a JSON file and run `scripts/land --pr-json FILE`.

```json
{
  "number": 12,
  "state": "MERGED",
  "headRefName": "feature-branch",
  "baseRefName": "main",
  "url": "https://github.com/owner/repo/pull/12",
  "isCrossRepository": false,
  "mergeCommit": { "oid": "abc1234..." },
  "stackedPrs": []
}
```

The script refuses a `state` other than `MERGED`, a missing field, or a
non-empty `stackedPrs` — that last one means step 3 was skipped and deleting
the head branch would destroy those PRs. Every field is required rather than
defaulted, because an empty `headRefName` would otherwise clean up the wrong
branch, or none, while still reporting success.

## Agent-driving notes

- Run it from the worktree that has the base branch checked out (the primary
  checkout, normally on `main`) with an explicit PR selector. Running from
  inside the feature worktree works, but the script removes that worktree on
  success, which leaves an agent shell with a deleted cwd — and a checkout
  that has the head branch checked out directly cannot be cleaned up at all.
- The script pulls the base branch (`--ff-only`) in its worktree as part of
  landing — the primary checkout hosts the running local dev stack, which
  picks changes up from there; no extra pull step is needed.
- Stacked PRs are handled: before deleting the head branch, the script
  retargets every open PR based on it onto this PR's base. Land the parent
  first and the child follows. Do not delete a head branch by hand while a PR
  is stacked on it — GitHub closes that PR and then refuses to reopen it, so
  the work has to be re-submitted as a new PR.
- After landing, confirm the script's final "Done: PR #N landed" line and
  report the merge commit to the user.
