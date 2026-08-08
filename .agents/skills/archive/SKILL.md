---
name: archive
description: Clean up the worktrees and branches this session owns, then archive the session. Use for /archive, or when the user asks to wrap up a session whose work will never land.
---

# Archive (adapter)

This is a harness-discovery adapter. The canonical procedure lives in
`skills/engineering/archive/SKILL.md` (repo-relative) — read and follow that
file exactly; do not improvise the cleanup order.

Reason for archiving: whatever the user gave, passed to the archive tool's
`reason` field. If the branch has an open PR that should merge, stop and use
`/land` instead.
