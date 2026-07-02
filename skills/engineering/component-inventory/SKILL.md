---
name: component-inventory
description: Maintain the Pop Charts UI component inventory. Use when Codex creates, edits, renames, removes, splits, consolidates, or materially changes React components under app/src/components, imports or adapts designkit/components references, or prepares UI work that should keep app/docs/component-inventory.md current.
---

# Component Inventory

Keep the living component ledger accurate enough that future UI work can reuse
existing primitives instead of recreating them.

## Workflow

1. Inspect the current component surface before editing the inventory:

```bash
find app/src/components -maxdepth 3 -type f | sort
find designkit/components -maxdepth 3 -type f | sort
rg -n "@/components/(ui|layout|charts)/" app/src --glob "*.ts" --glob "*.tsx"
git diff -- app/src/components designkit/components app/docs/component-inventory.md
```

2. Update `app/docs/component-inventory.md`.
   - Create it if it does not exist.
   - Treat `app/src/components` as production truth.
   - Treat `designkit/components` as visual/API reference material unless the
     task explicitly changes the design kit.
   - Add, rename, merge, or remove rows when exported shared components change.
   - Do not list page-local helpers unless they become exported shared
     components under `app/src/components`.

3. For each production component, keep these fields current:
   - Component name.
   - Repo-relative file path.
   - Design-kit reference, or `None`.
   - Purpose in one short phrase.
   - Public inputs, variants, or meaningful states.
   - Current usage surface or "Unused" if deliberately staged.

4. Cross-check before finishing.
   - Re-run the component and import scans.
   - Confirm removed or renamed components are reflected in the inventory.
   - For markdown-only inventory edits, run `git diff --check`.
   - For UI-impacting component edits, also use `skills/engineering/ui-pr-verification/SKILL.md`.

## Conventions

- Keep the inventory compact. Prefer a short table row over prose.
- Use repo-relative paths, not absolute paths, inside the inventory document.
- Preserve Pop Charts mechanism language and avoid third-party names in
  component identifiers, filenames, contract-like names, or branch names.
- Mark uncertainty directly in the row rather than pretending the inventory is
  complete. Use notes such as `Needs usage audit` or `Reference only`.
- If a prototype creates throwaway UI components, record only the durable result:
  absorbed, removed, or promoted to production.
