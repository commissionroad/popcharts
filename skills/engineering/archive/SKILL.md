---
name: archive
description: Clean up the worktrees and branches this session owns, then archive the session. Use for /archive, or when the user asks to wrap up and archive a session whose work will never land.
---

# Archive this session

Use this when the session's work is finished or abandoned and nothing needs to
merge. There is no script. Follow the steps below with `git`, `gh`, and the
session-management archive tool.

Stop if the branch has an open PR you intend to merge. Use `/land` instead.
Landing already deletes the branch on both sides and removes the worktree.

Two neighbouring commands do a different job. `/land` cleans up the PR it
merges. `scripts/prune-branches` sweeps up leftovers from sessions that already
ended, and it deliberately refuses to touch a worktree a live session sits in.
This command covers the remaining case: the session cleans up after itself,
from the inside, at the one moment that is safe — just before it stops.

This procedure removes local state only. It never deletes a remote branch
unless the user asks for that explicitly.

## 1. Resolve the primary checkout

Run `git worktree list --porcelain`. The first `worktree` line names the
primary checkout. Call that path PRIMARY.

Run every later git command as `git -C PRIMARY …`. Do not run git from a
worktree you are about to remove. `scripts/land` changes directory to `$HOME`
before it removes a worktree for exactly this reason.

## 2. List what this session owns

Record two things:

- This session's own worktree — the current working directory — and its branch.
- Any worktree this session created itself, normally under
  `PRIMARY/.worktrees/<slug>/`, and each of those branches.

Never remove a worktree this session did not create. Other sessions are live in
the sibling directories. Two parent directories hold worktrees —
`.worktrees/` and `.claude/worktrees/` — and both contain other agents' work.

If you are unsure whether this session created a worktree, leave it alone and
say so in the report.

## 3. Stop if a dev stack is live

Read the stack registry at `~/.popcharts/local-stacks/`. Look for a descriptor
whose `worktreePath` matches any worktree you plan to remove.

Stop and report the match if you find one. Removing a stack-hosting worktree
orphans the stack, and the devchain keeps its state in memory. `pnpm run
local:stack` has no whole-stack stop, so ask the user to stop the stack first.
Never call a process-compose control port directly.

## 4. Stop if the cleanup would lose work

Check every worktree and branch before you touch it:

- Uncommitted changes — `git -C <worktree> status --short`. Stop and report the
  files.
- An open PR — `gh pr list --state open --head <branch>`. Stop and report the
  PR.

Tag any branch that carries commits `main` does not have. Check with
`git -C PRIMARY log --oneline main..<branch>`, then tag it:

```
git -C PRIMARY tag -f "archive/$(date +%Y-%m-%d)/<branch>" <branch>
```

The tag keeps those commits reachable after the branch is gone. Keep this exact
tag shape — `scripts/prune-branches` uses it too, and the two must agree.

## 5. Remove the other worktrees first

For each extra worktree this session created, remove it and delete its branch:

```
git -C PRIMARY worktree remove <path>
git -C PRIMARY branch -D <branch>
```

## 6. Remove your own worktree and branch in one command

Gather every fact you still need before this step. Write the report text first.

`git branch -D` refuses a branch that is checked out in a worktree. So the
worktree must go first, and both commands must run inside one shell that has
already left the directory:

```
cd "$HOME" && git -C PRIMARY worktree remove <own worktree> && git -C PRIMARY branch -D <own branch>
```

Expect later Bash calls to fail after this command. The harness working
directory no longer exists. That is why the report text comes first.

## 7. Report, then archive

Write the summary before you archive. The conversation ends at the archive
call, so nothing runs after it.

State:

- Each worktree removed and each branch deleted.
- Every `archive/<date>/<branch>` tag created.
- Anything left alone, and why.

Then call the session-management archive tool with `session_id: "self"`. The
tool prompts the user for confirmation and stops the session. It also cleans up
the session worktree on its own, so a worktree that is already gone by then is
the expected outcome, not an error.

## When to suggest the preference instead

Suggest the "Auto-archive on PR close" setting if the user archives sessions
routinely after their PRs merge. This command covers the other case — work that
will never become a PR.
