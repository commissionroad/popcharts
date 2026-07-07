# Pop Charts Project Wiki — Schema

This directory is an LLM-maintained knowledge wiki over the repository's design
documentation. It follows the "LLM wiki" pattern (source:
https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f): humans
curate raw sources and ask questions; the LLM owns every file in `wiki/` and
keeps it synthesized, cross-linked, and current.

## Layers

1. **Raw sources** — immutable inputs, read but never edited as part of wiki
   work. They live in their existing locations:
   - `docs/` — cross-cutting architecture, design docs, and program ADRs (`docs/adr/`)
   - `protocol/docs/` + `protocol/docs/adr/` + `protocol/CONSTITUTION.md` + `protocol/CONTEXT.md`
   - `app/docs/` + `app/docs/adr/` + `app/CONTEXT.md`
   - `server/README.md`, `infra/README.md`, `designkit/readme.md`
   - `documents/*.pdf` — mechanism whitepapers (v4 is the mechanism source of
     truth per protocol ADR 0002)
2. **The wiki** — everything in this directory. LLM-generated and LLM-owned.
3. **The schema** — this file. Update it when better conventions emerge, and
   note schema changes in `log.md`.

The wiki summarizes *design intent* (docs), not the code itself. Code is the
ultimate ground truth for behavior; when a wiki page describes something a doc
promises but the code contradicts, flag it rather than silently pick a side.

## Directory layout

```
wiki/
├── CLAUDE.md          # this schema
├── index.md           # catalog of every page, grouped by type — read this FIRST
├── log.md             # append-only operation log
├── overview.md        # top-level orientation: what Pop Charts is, how the pieces fit
├── summaries/         # one page per ingested raw source
├── entities/          # contracts, services, workspaces, external systems
└── concepts/          # cross-document synthesis of mechanisms and programs
```

## Page conventions

- Filenames: kebab-case slugs, e.g. `entities/pregrad-manager.md`,
  `summaries/protocol-adr-0006-optimistic-offchain-graduation-clearing.md`.
- Summary slugs encode provenance: `<area>-<doctype>-<id>-<short-title>` for
  ADRs, `<area>-<short-title>` otherwise.
- Links between wiki pages are standard relative markdown links (render on
  GitHub, greppable). Links to raw sources use repo-root-relative paths.
- Every page starts with YAML frontmatter:

```yaml
---
type: summary | entity | concept
title: Human-readable title
description: One line, used verbatim in index.md
sources:            # repo paths of raw sources this page draws from
  - protocol/docs/adr/0006-use-optimistic-offchain-graduation-clearing.md
updated: 2026-07-07
---
```

- **Summary pages**: what the source says, decisions made, status
  (accepted/superseded/aspirational-vs-implemented if the doc says), and links
  to the entity/concept pages it touches.
- **Entity pages**: one per durable thing — a contract, service, workspace,
  or external dependency. Sections: What it is, Responsibilities, Key
  decisions affecting it (with ADR links), Related pages.
- **Concept pages**: one per mechanism or program that spans documents (e.g.
  market lifecycle, graduation clearing, creation-fee custody). These are the
  highest-value pages: they synthesize, they don't just aggregate.

## Operations

### Ingest (new or changed raw source)
1. Read the source in full.
2. Write or update its page in `summaries/`.
3. Update every entity/concept page the source touches — a single ADR often
   touches 3–10 pages. Create new entity/concept pages when a thing/mechanism
   now has two or more sources discussing it.
4. Update `index.md` (add/adjust the one-line description).
5. Append one entry to `log.md`.

### Query (answering questions from the wiki)
1. Read `index.md` first; open only the pages it points you to.
2. Do not bulk-read `raw/` sources during a query — the wiki page is the
   cache. If a page seems stale or insufficient, say so, then consult the raw
   source and fold what you learned back into the page (that's an ingest).
3. Answer with citations to wiki pages and, where load-bearing, raw sources.
4. If producing the answer required synthesis not already in the wiki and the
   topic is durable, file it as a new concept page.

### Lint (periodic health check)
1. Contradictions between pages, or between pages and newer ADRs.
2. Stale claims: pages whose `sources` have changed since `updated` (compare
   `git log -1 --format=%as -- <source>` against the frontmatter date).
3. Orphans: pages not linked from `index.md` or any other page.
4. Missing pages: entities/mechanisms referenced by 2+ pages that have no page.
5. ADR drift: summaries describing planned work — check whether the repo now
   shows it landed, and update status notes.
6. Record the lint run and its findings in `log.md`.

## log.md format

Append-only, newest at the bottom, one `##` heading per operation:

```
## [2026-07-07] ingest | protocol ADR 0006 — optimistic offchain graduation clearing
Pages: +summaries/..., ~entities/pregrad-manager.md, ~index.md
Notes: anything surprising, contradictions found, follow-ups.
```

Prefixes: `ingest`, `query`, `lint`, `schema`. `+` = created, `~` = updated,
`-` = removed.

## Division of labor

Humans: curate sources, ask questions, decide what's worth investigating.
LLM: all bookkeeping — summaries, cross-references, index, log, consistency.
Pages must be trustworthy at query time; if a page can't be trusted without
re-reading its sources, fix the page or delete it.
