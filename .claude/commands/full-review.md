---
description: Whole-file clean-code review of every file a PR touches
argument-hint: [pr-number | pr-url | branch]
---

Run the full-file standards review defined in
`skills/engineering/full-file-review/SKILL.md`.

Target: $ARGUMENTS — a PR number, PR URL, or branch. If empty, review the
current branch's open PR, falling back to the working diff against main.

Follow the skill exactly: resolve the touched-file list, read every file in
its entirety (never just the diff hunks), run the per-file standards pass
(clean-code, protocol-code-quality for protocol/ files, the architecture
depth lens for new modules, AGENTS.md repo rules) and the cross-file pass
(repo-wide duplication sweep, coordination-constant grep, dependency
direction, comment audit). Report findings per file as land-blocker /
follow-up / nit, each citing file:line and the rule violated. Do not apply
fixes unless asked.
