---
name: land
description: Land a GitHub PR — merge it, update the base branch locally, and clean up the feature branch/worktree. Use for /land or whenever the user asks to land or merge a finished PR.
---

# Land (adapter)

This is a harness-discovery adapter. The canonical procedure lives in
`skills/engineering/land/SKILL.md` (repo-relative) — read and follow that
file exactly; do not re-implement the landing steps by hand.

Target: the PR number, URL, or branch the user provided. If none, land the
PR for the current branch (the script refuses to run from main).
