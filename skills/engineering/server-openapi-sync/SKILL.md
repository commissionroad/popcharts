---
name: server-openapi-sync
description: Keep the server OpenAPI spec and the generated API client package in sync. Use when adding or changing Elysia routes, route schemas, or response models under server/src/api, when server:check fails on openapi:check, or when app code needs types for a new or changed endpoint.
---

# Server OpenAPI Sync

The API contract flows one way: TypeBox route schemas in `server/src/api` →
committed spec at `server/generated/openapi.json` → orval-generated client in
`packages/api-client/src/generated` (the `@popcharts/api-client` workspace
package the app consumes). All three are in git; only the first is
hand-written. When a route or model changes, regenerate the other two in the
same PR so `server:check` stays green and the app never types against a stale
contract.

## Pipeline

1. Change the route or schema in `server/src/api/routes/` or
   `server/src/api/models/`. Keep schemas next to routes so the OpenAPI output
   stays honest (see `server/AGENTS.md`).

2. Regenerate and validate the spec:

```bash
cd server && bun run openapi:generate
```

   This boots the Elysia app, exports a normalized OpenAPI 3.0 spec to
   `server/generated/openapi.json` (`scripts/generate-openapi.ts` strips
   TypeBox `$id` artifacts, expands bare `$ref`s, and rewrites
   `anyOf`-with-null to `nullable`), then validates it with the same parser
   orval uses (`scripts/validate-openapi.ts`).

3. Regenerate the client package from the committed spec:

```bash
pnpm --dir packages/api-client api:generate
```

   Orval (config in `packages/api-client/orval.config.ts`) reads
   `server/generated/openapi.json` by default — no running API needed — and
   writes tags-split fetch clients plus models under
   `packages/api-client/src/generated/`. Set `POPCHARTS_API_SPEC` to
   point at a live spec only when debugging generation itself.

4. Verify: `pnpm run server:check` (includes `openapi:check`, the `--check`
   mode that fails when the committed spec is stale),
   `pnpm --dir packages/api-client api:check` (fails when the committed
   client is stale), and `pnpm --dir app typecheck`.

## Rules

- Never hand-edit `server/generated/openapi.json` or anything under
  `packages/api-client/src/generated/`. Fix the route schema or the
  generator script instead (`skills/engineering/clean-code/SKILL.md`).
- Commit regenerated output as a mechanical commit separate from the
  behavioral schema change, and say so in the PR description
  ("Mechanical output of `bun run openapi:generate` (server) and
  `pnpm --dir packages/api-client api:generate`."). See
  `skills/engineering/pull-requests/SKILL.md`.
- If orval output looks wrong (synthesized model names, missing nullability),
  the fix belongs in the normalization pass of
  `server/scripts/generate-openapi.ts`, not in the generated files.
- New endpoints need their response models named in `components.schemas` —
  check the regenerated client for human-named models, not `MarketsGet200`
  style synthesized ones.

## Failure modes

- `openapi:check` fails in CI or `server:check` → step 2 was skipped after a
  route change; regenerate and commit.
- `api:check` fails in CI or `app:check`, or app typecheck fails on
  `@popcharts/api-client` imports after a server change → step 3 was skipped;
  regenerate the client.
- `validate-openapi.ts` fails → the route schema emits something OpenAPI 3.0
  cannot express; adjust the TypeBox schema or extend the normalizer, then
  rerun step 2.
