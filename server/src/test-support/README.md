# Test substrates and where each belongs

ADR 0017 Track B defines three test styles for the server. Pick by what the
test's risk actually is:

| Style                           | Substrate                            | File convention                                  | Runs                                                                             |
| ------------------------------- | ------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Fake executors / plain fixtures | none                                 | `*.test.ts`                                      | every `bun test`, CI unit step                                                   |
| Real-SQL unit tests             | in-process PGlite (`createPgliteDb`) | `*.test.ts` (often `*.pglite.test.ts`)           | every `bun test`, CI unit step                                                   |
| DB-boundary integration tests   | real Postgres (`createIntDb`)        | `*.int.test.ts` + `describe.skipIf(!INT_DB_URL)` | `bun run test:integration`; per-PR CI step with a `services: postgres` container |

**The boundary rule:** use real SQL for code whose risk _is_ the SQL — the
db layer, persistence with conflict/transaction semantics (the money paper
trail), route handlers reading through real queries. Keep fake executors
and plain fixtures for pure projection/serialization logic, where the SQL
chain is incidental and an in-memory object proves the same thing faster.

**PGlite vs the Postgres container:** PGlite is the default for unit-tier
real-SQL tests (zero setup, ~seconds). The per-PR Postgres container exists
for what PGlite can't represent — the deployed engine, concurrent
connections, DDL fidelity. Anything needing a chain or a second service
belongs in the nightly tier (Track C), not here.

Mechanics:

- `pglite-db.ts` — throwaway in-process database, schema applied via
  drizzle-kit `pushSchema` (works on the PGlite driver).
- `int-db.ts` — throwaway `popcharts_int_<hex>` database on the server
  behind `POPCHARTS_INT_DB_URL`, schema applied via drizzle-kit
  `generateMigration` DDL (`pushSchema` is incompatible with the
  postgres-js driver). Never points tests at a long-lived database.
- `require-int-db-url.ts` — makes `bun run test:integration` fail loudly
  instead of green-skipping when the URL is missing.
- `setDbForTesting()` (`src/db/client.ts`) — points the ambient `db`
  singleton at a test database for route-level `app.handle()` tests; the
  singleton is lazy, so no real connection is ever opened first.
- The unit coverage floor (`bunfig.toml`) is measured on the unit tier
  only; integration tests don't count toward it.
