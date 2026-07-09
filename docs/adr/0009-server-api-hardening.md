# ADR 0009: Server API Hardening

Status: Accepted

Date: 2026-07-06

## Context

The Elysia API (repo ADR 0006) is a deliberately read-only projection over
indexed chain events, with a mature Drizzle schema and generated OpenAPI. The
July 2026 audit found the gaps concentrated in security and product surface:
admin and dev endpoints are protected only by environment flags
(`POPCHARTS_ADMIN_REVIEW_ENABLED`, `POPCHARTS_DEV_TOOLS_ENABLED`), there is no
rate limiting or request correlation, the market list is capped at a
hardcoded 200 rows with no search, and nothing serves per-user portfolio or
postgrad market data.

## Decision

Harden the API's security posture and grow its product surface to cover the
full market lifecycle. The API stays read-only over chain state; writes remain
limited to metadata, review jobs, and operator actions. Deploying the API is
ADR 0015.

## Progress

Security and auth:

- [ ] Real operator authentication for `/admin/*` endpoints (replace the
      env-flag gate), shared with the AI review manual-override path
      (ADR 0011).
- [ ] Rate limiting on public endpoints.
- [ ] Request IDs / correlation logging across API, indexer, and runners.
- [ ] Decide and document the auth model for user-scoped endpoints (likely
      SIWE-style wallet signatures, since Privy holds the app session).

Product surface:

- [ ] Cursor pagination that removes the hardcoded `MARKET_LIST_LIMIT = 200`.
- [ ] Market search and category/status filtering.
- [x] Portfolio endpoints: receipts, claims, and postgrad positions by owner
      address.
- [x] Postgrad market surface (markets, trades, positions) once indexing
      lands (ADR 0010).
- [ ] Resolution status surface once resolution lands (ADR 0012).

Quality:

- [ ] Integration tests that exercise the running API against a real
      Postgres (today only unit tests exist).
- [ ] Server CI runs on every PR (workflow file itself belongs to ADR 0015;
      making the suite runnable headlessly belongs here).

## Exit Criteria

The app can render every page it owns (discovery, detail, portfolio,
graduation, postgrad trading, resolution) from API data alone with fixtures
disabled, and no privileged endpoint is reachable without operator
authentication.

## Consequences

- Adding wallet-signature auth introduces the first user-identity concept in
  the server; schema for users/sessions should be designed with the portfolio
  endpoints, not bolted on after.
- Rate limiting and auth add friction to local development; both must be
  disableable in the `local` network configuration.
