# Repository Agent Instructions

- `wiki/` is an LLM-maintained knowledge wiki over this repo's design docs
  (ADRs, whitepapers, architecture docs). When you need design context, read
  `wiki/index.md` first and open only the pages it points to, instead of
  bulk-reading docs. Maintenance rules (ingest/query/lint) are in
  `wiki/CLAUDE.md`; after changing any doc the wiki summarizes, run the
  ingest workflow for it.
- Never create, edit, delete, or otherwise mutate files outside this repository
  without explicit user approval. If a tool installer may change shell profiles,
  global config, home-directory caches, keychains, or other user files, ask first
  or use a non-mutating/local alternative.
- For UI-impacting work, use `skills/engineering/ui-pr-verification/SKILL.md`
  before publishing or updating a PR. Verify the real local user path when
  feasible, capture a screenshot of the changed state, and include the local
  verification notes plus screenshot in the PR description.
- Do not use third-party company, protocol, or product names in Pop Charts
  implementation identifiers, filenames, contract names, function names, script
  names, branch names, or deployment artifacts. Use descriptive mechanism names
  instead. Third-party names are allowed only when needed for source attribution,
  citations, or historical research context.

# Personal Commands

- When the user writes `/grill`, `/grill-with-docs`, or asks for an interactive
  "grill me" session, use `skills/engineering/grill-with-docs/SKILL.md`. The
  session is interactive: inspect docs/code when the answer is discoverable,
  ask one hard question at a time, include a recommended answer, and wait for
  the user's response before continuing. Update glossary/ADR docs inline only
  as decisions crystallize. Do not proceed to implementation until the user
  explicitly says to implement, continue, or take it from here after the grill.
- When the user writes `/land` or asks to land a PR, run `land` from the
  relevant repository. Pass a PR number, PR URL, or branch if the user provides
  one; otherwise run it from the feature branch worktree. The command merges the
  PR, updates the base branch locally, removes the feature worktree, and deletes
  the feature branch.
