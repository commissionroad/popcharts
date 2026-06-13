# popcharts

## Engineering Skills

The `skills/` directory vendors the engineering skills selected for Pop Charts'
frontend buildout. They are adapted from
[`mattpocock/skills`](https://github.com/mattpocock/skills) and cover planning
with docs, TDD, diagnosis, architecture review, throwaway prototypes, and
pre-commit setup.

## Developer Helpers

Use `scripts/land` to merge a GitHub pull request, fast-forward the base branch locally, remove the feature worktree, and delete the feature branch.

```bash
scripts/land 12
scripts/land codex/my-feature
scripts/land --squash 12
```
