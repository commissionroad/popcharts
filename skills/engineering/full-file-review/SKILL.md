---
name: full-file-review
description: Whole-file standards review of every file a PR touches — reuse, coordination constants, comments, dependency direction, naming — using the repo's clean-code skills. Use for /full-review, or whenever a PR is ready and its files should be held against house standards, not just its diff hunks.
---

# Full-File Review

Diff-scoped review answers "is this change correct?" This review answers "are
the files this change touched clean?" — it reads every touched file **in its
entirety** and holds it against the repo's standards suite. Duplicated
helpers, mirrored magic strings, and missing why-comments are invisible in a
diff hunk; they only show up at file and repo scope.

Motivating incident (PR #210): two deploy tools each wrote their own marker
block into the same env file with overlapping keys. The diff of each tool
looked fine in isolation; the duplication across tools silently shadowed live
contract addresses via dotenv's last-duplicate-wins. A whole-file pass with a
repo-wide duplication sweep catches exactly this class.

## Scope

1. Resolve the file list:
   - PR number or URL → `gh pr view <n> --json files --jq '.files[].path'`
   - branch → `git diff --name-only main...<branch>`
   - no argument → the working diff plus staged/untracked source files
2. Exclude: `generated/` output, lockfiles, snapshots, vendored code, and
   binary assets. Fix generators, not their output.
3. Read each remaining file **whole**. Never review from the diff hunks alone.

## Per-file pass

Hold every file against the applicable standards, citing the specific rule
when reporting:

- `engineering/clean-code` — the full checklist: file size and placement,
  reuse, function design, naming, comments and JSDoc on exports.
- `engineering/protocol-code-quality` — additionally, for `protocol/` files.
- `engineering/improve-codebase-architecture` — when the file defines a new
  module or seam, apply the depth lens (deletion test, interface vs
  implementation complexity).
- Repo rules from `AGENTS.md` — mechanism names instead of third-party names
  in identifiers; generated ABIs only for first-party contracts; the money
  paper-trail invariant for anything touching value transfers.

## Cross-file pass

These checks need repo scope — run them for every touched file:

1. **Duplication sweep.** For each helper, constant, or regex the file
   defines, search the repo for a same-name or same-body sibling
   (`grep -rn` on the function name and on distinctive body fragments).
   Two copies → finding: one must export, the other must import.
2. **Coordination constants.** Any literal that more than one tool or module
   must agree on — marker strings, env keys, ports, queue or table names,
   sentinel comments — must have exactly one definition. Grep for the literal
   itself; a second occurrence outside imports/tests of the defining module
   is a finding, even when the copies are currently identical.
3. **Dependency direction.** Imports respect layer and workspace rules
   (`app/src/domain` purity, route files free of domain logic, protocol not
   reaching upward). A cross-workspace import is acceptable only with a
   comment at the import site naming the constraint that forces it (loader
   conventions, node_modules type-stripping limits).
4. **Comment audit.** Every non-obvious regex, flag, ordering requirement,
   unit, or workaround has a why-comment; every export has contract JSDoc;
   any option or flag with no observable effect is deleted, not documented.

## Report

Group findings per file, ordered most severe first:

- **land-blocker** — violates an invariant or will bite (duplicated
  coordination constant, wrong-direction import, missing paper trail).
- **follow-up** — real but severable; propose spinning it into its own task.
- **nit** — style drift worth one line.

Each finding cites file:line, the rule violated (skill + section), and the
concrete fix. Close with a one-paragraph verdict. Apply fixes only when the
user asks (or the command was invoked with `--fix`), re-running the relevant
workspace gates afterward.
