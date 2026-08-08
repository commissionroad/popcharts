---
description: Delete branches and worktrees that no longer back live work
argument-hint: [--yes] [--remote]
---

Follow `skills/engineering/prune-branches/SKILL.md` exactly — it is the single
source of truth; do not re-implement the checks by hand.

Arguments: $ARGUMENTS — passed straight through to `scripts/prune-branches`.
If empty, run the report form and show the user what it proposes before
applying anything.
