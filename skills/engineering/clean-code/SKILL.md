---
name: clean-code
description: House standards for file size and structure, folder layout, code reuse, function design, naming, comments, and JSDoc on exports. Use when writing or refactoring TypeScript anywhere in the repo, or when reviewing code for cleanliness.
---

# Clean Code Standards

These codify the conventions established by the `protocol/` TypeScript
refactor. They apply to all TypeScript in the repo: `protocol/`, `scripts/`,
`server/`, `app/`, `infra/`.

## Files and folders

- **One exported concept per helper file**, named after its main export:
  `marketFileSlug.ts` exports `marketFileSlug`. Types that only exist to
  serve that export live in the same file.
- Shared helpers live under a `shared/<domain>/` tree grouped by domain
  (`chain/`, `market/`, `price/`, `json/`, `explorer/`), not by technical kind
  (`utils/`, `helpers/`, `misc/`). If you're about to create `utils.ts`, find
  the domain instead.
- **Size guardrails**: helpers under ~100 lines; entrypoint scripts and route
  files under ~300. Past that, extract steps into shared helpers. A file you
  must scroll to understand is a file to split — but don't shard a cohesive
  module into fragments that force readers to bounce between files
  (see `engineering/tdd/deep-modules.md`: deep modules beat many shallow ones).
- Generated code (`generated/` directories) is never hand-edited and is exempt
  from all of this; fix the generator or its input instead.

## Reuse

- Before writing a helper, search the nearest `shared/` tree and the other
  workspaces for an existing one. Duplicated JSON I/O, chain config, address
  parsing, and env handling are the classic offenders.
- One source of truth per fact. If two workspaces need the same constant or
  schema, one exports it and the other imports it — don't copy.
- Don't extract a helper for one caller and speculative reuse; extract when a
  second caller exists or the extraction makes the caller readable.

## Functions

- Single purpose, typed boundaries: explicit parameter and return types on
  exports; no `any` at a public seam.
- Three or more parameters, or any two of the same type → a single `args`
  object with `readonly` fields.
- Validate at the edges (CLI args, env, JSON from disk, RPC responses), then
  pass trusted, typed values inward. Interior functions don't re-validate.
- Fail loudly with actionable messages ("expected chainId 31337, got 1"), and
  read state back after writes when the function claims an on-chain effect.

## Naming

- Use the domain vocabulary from the whitepapers and `CONTEXT.md` exactly:
  `Graduation`, `Receipt`, `Price band`, `postgrad`, `venue` — never invent a
  synonym for an existing term.
- Full words over abbreviations (`deployment`, not `depl`). Booleans read as
  predicates (`isEligible`, `hasShortfall`). Functions are verbs; values are
  nouns; a returned promise's name doesn't mention promises.
- File names are camelCase and match their main export; directories are
  lowercase domains.

## Comments and JSDoc

- **Every exported function, type, and constant gets a JSDoc/TSDoc comment**:
  1–3 sentences stating what it guarantees and why it exists — the contract,
  not a restatement of the signature. Reference ADRs when the behavior encodes
  a decision (e.g. "widens — never narrows — a display-price range (ADR 0009)").
- Interior comments only for constraints the code can't express: invariants,
  units, ordering requirements, workaround references. No narration ("loop
  over markets"), no changelog ("moved from utils.ts"), no commented-out code.
- If a comment explains *what* the code does, rewrite the code until the
  comment is unnecessary; keep comments that explain *why*.

## Definition of done

Code is clean when: gates pass (`format:check`, `lint`, `typecheck`, `test`),
every export has a contract comment, no helper duplicates an existing one, and
a reader can predict a file's contents from its path and name.
