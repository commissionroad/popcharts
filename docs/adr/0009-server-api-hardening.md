# ADR 0009: Server API Hardening

Status: Accepted

Date: 2026-07-06

## Context

The Elysia API (repo ADR 0006) is a deliberately read-only projection over
indexed chain events, with a mature Drizzle schema and generated OpenAPI. The
July 2026 audit found the remaining gaps concentrated in security and product
surface.

The `/admin/*` and `/dev/*` endpoints are development-testing tools, not a
production operator surface. Today they are only env-flag-gated
(`POPCHARTS_ADMIN_REVIEW_ENABLED`, `POPCHARTS_DEV_TOOLS_ENABLED`), which is the
wrong mechanism: a misconfigured flag would expose them. Operator-level actions
(manual re-review, resolution override, any key-signed transition) must never
be reachable through the deployed API at all — operators run them locally
against the chain with the operator keys. So the security work here is to keep
those endpoints out of production, not to authenticate them.

The other real gaps: there is no rate limiting or request correlation; the
market list is capped at a hardcoded 200 rows with no search; and the one
legitimate public *write* — the manual graduation trigger — is currently a
read-only stub that never kicks anything off.

## Decision

Harden the API's security posture and grow its product surface to cover the
full market lifecycle. The API stays a read-only projection over chain state.
The only writes it exposes are safe public ones: market metadata and a
graduation trigger that kicks off the server's (manager-keyed) graduation
process for a threshold-eligible market (protocol ADR 0006). Operator-level
actions are never exposed through the API — they run locally against the chain
with the operator keys — and the dev/admin testing endpoints are excluded from
production builds entirely. Deploying the API is ADR 0015.

## Progress

Security and auth:

- [x] Exclude the dev/admin testing endpoints (`/admin/*`, `/dev/*`) from
      production builds entirely — not merely env-flag-gated, since a
      misconfigured flag would expose them. Operator-level actions run locally
      against the chain with the operator keys (a local admin panel), never
      through the deployed API (see ADR 0011, ADR 0012). *(Routes mounted only
      when `config.name === "local"`; deployed networks register 15 routes with
      zero `/admin`+`/dev`, local registers all 18.)*
- [ ] Rate limiting on public endpoints.
- [ ] Request IDs / correlation logging across API, indexer, and runners.
- [ ] Decide and document the auth model for user-scoped read endpoints
      (likely SIWE-style wallet signatures, since Privy holds the app
      session). This is distinct from operator access, which the API does not
      grant at all.

Product surface:

- [ ] Make the graduation trigger real. `POST /markets/:chainId/:marketId/graduate`
      currently only reports status. It must kick off the server's graduation
      process — start graduation, off-chain band-pass clearing, Merkle-root
      submission, finalize — for a market that has genuinely reached threshold.
      The call is public and unauthenticated by design: safety comes from the
      server re-checking eligibility plus the on-chain conservation checks, not
      from a gate, because on-chain `startGraduation` is manager-only and the
      band sweep cannot fit in one transaction (protocol ADR 0006). It exists
      as a safeguard for markets the keeper misses.
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
disabled. The deployed API exposes only read projections plus the two safe
public writes (market metadata and the graduation trigger); the dev/admin
testing endpoints are absent from the production build, and no operator-level
action is reachable through the API.

## Consequences

- Adding wallet-signature auth for user-scoped reads introduces the first
  user-identity concept in the server; schema for users/sessions should be
  designed with the portfolio endpoints, not bolted on after.
- Rate limiting adds friction to local development and must be disableable in
  the `local` network configuration.
- The graduation trigger causes the server to sign manager-keyed transactions;
  that key is loaded from config and never exposed to callers (mirror the
  review-manager key handling in ADR 0011). Excluding the dev/admin endpoints
  from production is a build/wiring concern, not a runtime flag — the safest
  gate is code that is not shipped.
