---
name: verdict-next
description: Run one pass of the ADR 0027 AI-verdict-quality loop — one catalogue item, one measured change, one verdict-loop PR. Use for /verdict-next or whenever the user asks to advance the verdict-quality loop.
---

# Verdict next (adapter)

This is a harness-discovery adapter. The canonical procedure lives in
`skills/engineering/verdict-next/SKILL.md` (repo-relative) — read and follow
that file exactly; do not re-implement the pass by hand.

Target: the catalogue item id the user provided, else the first eligible
unchecked `- [ ]` box in `docs/adr/0027-verdict-quality-loop.md`. Never
merge the resulting PR.
