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

The whole flow must run without permission prompts, up to the one built-in
confirmation at the archive call (step 7). The user types `/archive` and walks
away, so any other prompt stalls the session unattended. Every command
below stays inside a plain shell vocabulary (`git`, `gh`, `ls`, `cat`, `grep`,
`date`) that harnesses pre-approve. Keep that property when you adapt. Three
things break it: a `$(…)` substitution inside another command, a `cd` outside
the workspace, and file-reader tools on paths outside the repository.

## 1. Resolve the primary checkout

Run `git worktree list --porcelain`. The first `worktree` line names the
primary checkout. Call that path PRIMARY.

Run every later git command as `git -C PRIMARY …`. Then no command depends on
the directory it starts in, and step 6 works even while the shell still stands
in the worktree it removes. (`scripts/land` must `cd` to `$HOME` first because
it is one long-lived process; a per-command shell has no such need.)

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

Check the stack registry with shell commands — not with a file-reader tool,
which needs a separate approval outside the repository:

```
grep -rs worktreePath ~/.popcharts/local-stacks/
```

No output means no live stack. Look for a `worktreePath` that matches any
worktree you plan to remove.

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
`git -C PRIMARY log --oneline main..<branch>`. Then get the date as its own
command, and write the literal result into the tag name:

```
date +%Y-%m-%d
git -C PRIMARY tag -f "archive/<date>/<branch>" <branch>
```

Do not embed `$(date …)` in the git command. A command substitution stops the
harness from matching the command against its pre-approved rules, and the step
stalls on a prompt.

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
worktree must go first, and both commands must run as one command — after the
first, no directory exists for a second shell to start in:

```
git -C PRIMARY worktree remove <own worktree> && git -C PRIMARY branch -D <own branch>
```

Do not prefix this with `cd "$HOME"`. The removal works with the shell still
inside the worktree, because git runs from PRIMARY. A `cd` out of the
workspace only adds a permission prompt.

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
tool always asks the user to confirm — that is the flow's one intended
approval, and no pre-approval removes it — then stops the session. It also cleans up
the session worktree on its own, so a worktree that is already gone by then is
the expected outcome, not an error.

## When to suggest the preference instead

Suggest the "Auto-archive on PR close" setting if the user archives sessions
routinely after their PRs merge. This command covers the other case — work that
will never become a PR.
