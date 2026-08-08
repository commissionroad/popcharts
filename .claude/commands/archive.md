---
description: Clean up this session's worktrees and branches, then archive the session
argument-hint: [reason]
---

Follow `skills/engineering/archive/SKILL.md` exactly — it is the single source
of truth; do not improvise the cleanup order.

Reason for archiving: $ARGUMENTS — pass it to the archive tool's `reason` field
if non-empty. If the branch has an open PR that should merge, stop and use
`/land` instead.
