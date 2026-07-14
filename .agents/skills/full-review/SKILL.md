---
name: full-review
description: Whole-file clean-code review of every file a PR touches — reuse, coordination constants, comments, dependency direction, naming. Use for /full-review or when a PR's files should be held against house standards, not just its diff.
---

# Full Review (adapter)

This is a harness-discovery adapter. The canonical procedure lives in
`skills/engineering/full-file-review/SKILL.md` (repo-relative) — read and
follow that file exactly; do not improvise a lighter version.

Target: the PR number, URL, or branch the user provided. If none, review the
current branch's open PR, falling back to the working diff against main.
