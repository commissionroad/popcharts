---
name: prune-branches
description: Delete branches and worktrees that no longer back live work — merged branches, closed-PR branches, and leftover worktree directories — by running the repo's prune script.
---

# Prune stale branches and worktrees

The single source of truth is the executable: run `scripts/prune-branches` from
inside the repository. Do not re-implement its checks by hand with `git`/`gh` —
every one of them is a guard against deleting live work, and the script is
where fixes to that procedure belong.

## Invocation

```
scripts/prune-branches            # report only, change nothing
scripts/prune-branches --yes      # apply
scripts/prune-branches --yes --remote   # also delete stale branches on origin
```

Run the bare form first and read what it proposes. Deleting a branch is not
reversible from the user's point of view even when the objects survive.

## What it does and does not touch

Prunes:

- Local branches contained in `origin/main`.
- Local branches whose PR is closed or merged, after tagging the tip
  `archive/<date>/<branch>` so the commits stay reachable.
- Worktrees for those branches, and directories under `.worktrees/` or
  `.claude/worktrees/` that git no longer tracks as worktrees.
- With `--remote`, the same classes on `origin`.

Never touches:

- A branch with an open PR, `main`, or the branch you are standing on.
- A worktree with uncommitted changes, a locked worktree, or one an
  unarchived Claude session is sitting in.
- Anything modified in the last 6 hours — worktrees and untracked directories
  alike (`PRUNE_MIN_IDLE_HOURS` overrides). A directory with no `.git` is also
  what a worktree looks like in the seconds before `git worktree add`
  finishes, so recency covers that sweep too.
- A branch carrying unique commits with no PR at all. Those are reported for
  you to judge, never deleted — nothing else in this repo tracks them.

Refuses rather than guesses:

- If the archive tag cannot be written, the branch is not deleted. "Archived
  first" is what makes deleting an unmerged tip acceptable.
- If `git fetch` fails, `origin/main` is stale and `--auto` stands down
  entirely; a manual run warns and continues. Judging "already merged"
  against a stale base is how a force-push turns into lost commits.
- Branch deletion pins the commit it judged (`git update-ref -d` with the
  expected old value), so a ref another process advanced in between is
  refused, not destroyed.

## Agent-driving notes

- `scripts/land` already cleans up the PR it lands. Reach for this command for
  what landing cannot see: a session branch that never became a PR, worktree
  scaffolding, or a branch whose PR was closed without merging.
- A `--auto` mode runs from the SessionStart hook in `.claude/settings.json`.
  It only prunes branches provably contained in `origin/main`, never calls
  GitHub, and always exits 0. Do not invoke `--auto` by hand; use the plain
  form, which also handles the closed-PR and remote cases.
- If the report lists branches under "carrying unmerged commits with no PR",
  show them to the user and ask. Do not delete them on your own initiative.
- `scripts/test/prune-branches.test.ts` covers every guard above against a
  throwaway repo. Change the script and run `pnpm run scripts:test`; three
  separate bugs in this script each silently turned a guard into a no-op, and
  the tests are what caught them.
