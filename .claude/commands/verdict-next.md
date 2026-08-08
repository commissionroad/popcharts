---
description: Run one pass of the ADR 0027 AI-verdict-quality loop
argument-hint: [catalogue-id e.g. A1 | empty = next eligible unchecked]
---

Follow `skills/engineering/verdict-next/SKILL.md` exactly — it is the single
source of truth for one loop pass; do not improvise a lighter version.

Catalogue: `docs/adr/0027-verdict-quality-loop.md`. If it does not exist on
origin/main yet, report that the loop is waiting on it and stop.

Target: $ARGUMENTS — a catalogue item id. If empty, take the first eligible
unchecked `- [ ]` box top to bottom (skipping `DEPENDS`/`BLOCKED` items per
the skill).

Run exactly **one** item: preflight (all no-op checks before any worktree —
Phase 0 landed, last two ledger rows not gate-failed, no open `verdict-loop`
PR), execute the item-type playbook, measure with `--runs 3` minimum where
required on the off-grid eval ports, gate the touched workspace, and ship
one `verdict-loop` PR that ticks the box and appends the ledger row. Never
merge.

To walk the whole catalogue one item at a time, run this command under the
loop: `/loop /verdict-next`.
