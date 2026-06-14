# Repository Agent Instructions

- Never create, edit, delete, or otherwise mutate files outside this repository
  without explicit user approval. If a tool installer may change shell profiles,
  global config, home-directory caches, keychains, or other user files, ask first
  or use a non-mutating/local alternative.

# Personal Commands

- When the user writes `/land` or asks to land a PR, run `land` from the
  relevant repository. Pass a PR number, PR URL, or branch if the user provides
  one; otherwise run it from the feature branch worktree. The command merges the
  PR, updates the base branch locally, removes the feature worktree, and deletes
  the feature branch.
