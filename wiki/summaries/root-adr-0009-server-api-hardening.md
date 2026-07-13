---
type: summary
title: Repo ADR 0009 — Server API hardening
description: Vertical ADR to keep dev/admin endpoints out of production, add rate limiting, make the graduation trigger real, and grow the lifecycle product surface (search, pagination, portfolio, postgrad) of the read-only Elysia API. Operator actions are never exposed via the API.
sources:
  - docs/adr/0009-server-api-hardening.md
updated: 2026-07-13
---

# Repo ADR 0009: Server API Hardening

**Status: Accepted.** Dated 2026-07-06. Vertical checklist per ADR 0007
([summary](root-adr-0007-track-verticals-with-progress-adrs.md)).

## Context

The Elysia API (repo ADR 0006) is a deliberately read-only projection over
indexed chain events, with a mature Drizzle schema and generated OpenAPI. The
July 2026 audit found the remaining gaps concentrated in security and product
surface. The `/admin/*` and `/dev/*` endpoints are dev-testing tools, only
env-flag-gated today (`POPCHARTS_ADMIN_REVIEW_ENABLED`,
`POPCHARTS_DEV_TOOLS_ENABLED`) — the wrong mechanism, since a misconfigured
flag would expose them; they must be excluded from production builds entirely.
Operator-level actions (manual re-review, resolution override, key-signed
transitions) are never reachable through the deployed API — operators run them
locally against the chain. Other gaps: no rate limiting or request
correlation; the market list capped at a hardcoded 200 rows with no search;
and the one legitimate public write — the manual graduation trigger — is a
read-only stub that never kicks anything off.

## Decision

Harden the API's security posture and grow its product surface across the
full market lifecycle. The API stays a read-only projection; the only writes
it exposes are safe public ones — market metadata and a graduation trigger
that kicks off the server's (manager-keyed) graduation process for a
threshold-eligible market (protocol ADR 0006). Operator actions are never
exposed via the API, and the dev/admin testing endpoints are excluded from
production builds. Deploying the API is ADR 0015.

## Progress (3 of 12 done as of the 2026-07-09 checklist reconcile)

Security and auth:

- [x] Exclude the dev/admin testing endpoints (`/admin/*`, `/dev/*`) from
  production builds entirely — not env-flag-gated. Operator actions run
  locally against the chain (a local admin panel), never via the deployed API
  (ADR 0011, ADR 0012). Done: routes mount only when `config.name === "local"`.
- [ ] Rate limiting on public endpoints.
- [ ] Request IDs / correlation logging across API, indexer, and runners.
- [ ] Decide/document the auth model for user-scoped read endpoints (likely
  SIWE-style wallet signatures) — distinct from operator access, which the API
  does not grant.

Product surface:

- [ ] Make the graduation trigger real: `POST /markets/:chainId/:marketId/graduate`
  must kick off the server's graduation process (start → off-chain band-pass
  clearing → Merkle root → finalize) for a threshold-eligible market. Public
  and unauthenticated by design; safety comes from server-side eligibility
  re-checks and on-chain conservation, because `startGraduation` is
  manager-only and the sweep cannot fit in one transaction (protocol ADR
  0006).

Product surface:

- [ ] Cursor pagination removing the hardcoded `MARKET_LIST_LIMIT = 200`.
- [ ] Market search and category/status filtering.
- [x] Portfolio endpoints: receipts, claims, postgrad positions by owner.
- [x] Postgrad market surface (markets, trades, positions) once indexing
  lands (ADR 0010).
- [ ] Resolution status surface once resolution lands (ADR 0012).

Quality:

- [ ] Integration tests exercising the running API against a real Postgres
  (today only unit tests exist).
- [ ] Server CI runs on every PR (the workflow file belongs to ADR 0015;
  making the suite headlessly runnable belongs here).

## Exit criteria

The app renders every page it owns (discovery, detail, portfolio, graduation,
postgrad trading, resolution) from API data alone with fixtures disabled. The
deployed API exposes only read projections plus the two safe public writes
(metadata and the graduation trigger); the dev/admin testing endpoints are
absent from the production build, and no operator-level action is reachable
through the API.

## Consequences

Wallet-signature auth for user-scoped reads introduces the server's first
user-identity concept — design the users/sessions schema together with the
portfolio endpoints, not after. Rate limiting must be disableable in the
`local` network configuration. The graduation trigger causes the server to
sign manager-keyed transactions; that key is loaded from config and never
exposed to callers. Excluding the dev/admin endpoints from production is a
build/wiring concern, not a runtime flag — the safest gate is code that is not
shipped.

## Related pages

- [../entities/server-workspace.md](../entities/server-workspace.md)
- [../entities/indexer.md](../entities/indexer.md)
- [../entities/app-workspace.md](../entities/app-workspace.md)
- [../entities/ai-review-service.md](../entities/ai-review-service.md)
- [../concepts/market-lifecycle.md](../concepts/market-lifecycle.md)
