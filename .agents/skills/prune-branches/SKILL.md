---
name: prune-branches
description: Delete branches and worktrees that no longer back live work — merged branches, closed-PR branches, and leftover worktree directories. Use for /prune-branches or whenever the user asks to clean up stale branches or worktrees.
---

# Prune branches (adapter)

This is a harness-discovery adapter. The canonical procedure lives in
`skills/engineering/prune-branches/SKILL.md` (repo-relative) — read and follow
that file exactly; do not re-implement the checks by hand.

Run the report form first and show the user what it proposes before applying.
