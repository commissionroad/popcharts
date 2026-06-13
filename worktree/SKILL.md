---
name: worktree
description: Establish and use an isolated git worktree for repository-changing Codex tasks, then publish completed work as a ready pull request. Use before creating, editing, formatting, deleting, generating, staging, committing, pushing, opening a PR, starting feature or fix work, addressing review feedback, fixing CI, or cleaning up Codex worktrees.
---

# Worktree

## Rule

Do repository-changing work from a dedicated git worktree, not from the user's current checkout. Treat the original checkout as context and as the parent repository for `git worktree`; do not make edits, run write-producing installs or builds, or create commits there.

Skip worktree setup only when the task is read-only, the current directory is not inside a git repository, the user explicitly asks to work in the current checkout, or git worktrees are unavailable. If setup is skipped for anything except read-only work, tell the user why before modifying files.

## Setup

Inspect the current repository before writing anything:

```bash
git rev-parse --show-toplevel
git branch --show-current
git status --short
git worktree list --porcelain
```

If the current directory is already a dedicated worktree for this task, keep using it. Otherwise, create a new sibling worktree outside the original checkout.

Use a task-specific branch named `codex/<slug>` unless the user requested a different branch name. Keep the slug short, lowercase, and hyphenated. Add a timestamp or short suffix if the branch or worktree path already exists.

Put worktrees under a sibling directory named `<repo>-worktrees`:

```bash
repo_root="$(git rev-parse --show-toplevel)"
repo_name="$(basename "$repo_root")"
worktree_root="$(dirname "$repo_root")/${repo_name}-worktrees"
mkdir -p "$worktree_root"
git worktree add -b "codex/<slug>" "$worktree_root/<slug>" HEAD
```

If the branch already exists, attach it with:

```bash
git worktree add "$worktree_root/<slug>" "codex/<slug>"
```

If that branch is checked out in another worktree, create a new unique branch instead of disturbing the existing one.

## Working

Run all repository commands from the worktree path. In tool calls, set `workdir` to the worktree; for file edits, target files inside the worktree with absolute paths when the edit tool has no `workdir` option.

Do not move, revert, stash, or commit the user's changes from the original checkout. If the original checkout has uncommitted changes that appear necessary for the task, pause and ask before copying or depending on them.

Install dependencies, generate files, run formatters, run tests, stage, commit, and push only from the dedicated worktree.

## Publishing

After making repository changes in a dedicated worktree, publish the completed work unless the user explicitly asked not to:

1. Run appropriate verification for the change, or explain why verification could not be run.
2. Stage only the intended changes and create a meaningful commit if the work is not already committed.
3. Push the branch to the appropriate remote, usually `origin`.
4. Open a real, ready-for-review pull request against the appropriate base branch. Do not create a draft PR unless the user explicitly asks for a draft.
5. Report the PR URL, worktree path, branch, commit, and verification result.

If authentication, missing remotes, permissions, CI state, or network access prevents pushing or opening the PR, explain the blocker clearly and leave the worktree ready to push or PR later.

## Landing

After a successful `/land` or any user-requested PR merge for a `codex/*` branch, clean up the Codex branch and worktree before finishing:

1. Confirm the PR is merged and record the merge commit.
2. Delete the remote head branch if it still exists.
3. If the branch is checked out in a dedicated worktree, verify that worktree is clean, then remove it.
4. Delete the local `codex/*` branch. Use `git branch -D` after a confirmed merge or explicit cleanup request because the local branch may have been squash-merged, rebased, or otherwise not appear merged to Git.
5. Verify cleanup before reporting success.

Useful commands:

```bash
git push origin --delete "codex/<slug>"
git -C "<worktree-path>" status --short
git worktree remove "<worktree-path>"
git branch -D "codex/<slug>"
git branch --list "codex/*"
git branch -r --list "origin/codex/*"
git worktree list --porcelain
```

If a merge command reports a local checkout or worktree cleanup error, first check whether the remote PR actually merged. If it did, complete branch and worktree cleanup manually with the steps above.

## Cleanup

Leave the worktree in place by default. Remove it only when the user asks for cleanup and it has no uncommitted work:

```bash
git -C "<worktree-path>" status --short
git worktree remove "<worktree-path>"
git branch -d "codex/<slug>"
```

Use `git branch -D` only when the user explicitly confirms that the branch can be discarded.
