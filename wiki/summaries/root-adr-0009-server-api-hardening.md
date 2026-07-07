---
type: summary
title: Repo ADR 0009 — Server API hardening
description: Vertical ADR to add real operator auth, rate limiting, and lifecycle product surface (search, pagination, portfolio, postgrad) to the read-only Elysia API; all eleven items open.
sources:
  - docs/adr/0009-server-api-hardening.md
updated: 2026-07-07
---

# Repo ADR 0009: Server API Hardening

**Status: Accepted.** Dated 2026-07-06. Vertical checklist per ADR 0007
([summary](root-adr-0007-track-verticals-with-progress-adrs.md)).

## Context

The Elysia API (repo ADR 0006) is a deliberately read-only projection over
indexed chain events, with a mature Drizzle schema and generated OpenAPI. The
July 2026 audit found gaps concentrated in security and product surface: admin
and dev endpoints are protected only by environment flags
(`POPCHARTS_ADMIN_REVIEW_ENABLED`, `POPCHARTS_DEV_TOOLS_ENABLED`); no rate
limiting or request correlation; the market list capped at a hardcoded 200
rows with no search; nothing serves per-user portfolio or postgrad market
data.

## Decision

Harden the API's security posture and grow its product surface across the
full market lifecycle. The API stays read-only over chain state; writes remain
limited to metadata, review jobs, and operator actions. Deploying the API is
ADR 0015.

## Progress (all items unchecked as of 2026-07-07)

Security and auth:

- [ ] Real operator authentication for `/admin/*` (replacing the env-flag
  gate), shared with the AI review manual-override path (ADR 0011).
- [ ] Rate limiting on public endpoints.
- [ ] Request IDs / correlation logging across API, indexer, and runners.
- [ ] Decide/document the auth model for user-scoped endpoints (likely
  SIWE-style wallet signatures, since Privy holds the app session).

Product surface:

- [ ] Cursor pagination removing the hardcoded `MARKET_LIST_LIMIT = 200`.
- [ ] Market search and category/status filtering.
- [ ] Portfolio endpoints: receipts, claims, postgrad positions by owner.
- [ ] Postgrad market surface (markets, trades, positions) once indexing
  lands (ADR 0010).
- [ ] Resolution status surface once resolution lands (ADR 0012).

Quality:

- [ ] Integration tests exercising the running API against a real Postgres
  (today only unit tests exist).
- [ ] Server CI runs on every PR (the workflow file belongs to ADR 0015;
  making the suite headlessly runnable belongs here).

## Exit criteria

The app renders every page it owns (discovery, detail, portfolio, graduation,
postgrad trading, resolution) from API data alone with fixtures disabled, and
no privileged endpoint is reachable without operator authentication.

## Consequences

Wallet-signature auth introduces the server's first user-identity concept —
design the users/sessions schema together with the portfolio endpoints, not
after. Rate limiting and auth must be disableable in the `local` network
configuration.

## Related pages

- [../entities/server-workspace.md](../entities/server-workspace.md)
- [../entities/indexer.md](../entities/indexer.md)
- [../entities/app-workspace.md](../entities/app-workspace.md)
- [../entities/ai-review-service.md](../entities/ai-review-service.md)
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md)
