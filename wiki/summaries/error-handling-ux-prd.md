---
type: summary
title: Error-handling UX PRD — never surface raw errors
description: Safe-by-default error presentation — invert getErrorMessage to presentError, always-log sink, DisplayableError allow-list, CI guardrail against raw error.message renders; dev menu can re-reveal raw text.
sources:
  - docs/error-handling-ux-prd.md
updated: 2026-07-09
---

# Error-handling UX PRD: never surface raw errors (docs/error-handling-ux-prd.md)

Status: **Implemented (2026-07-08).** A product requirements doc, not an ADR;
it lives at repo root `docs/` alongside the portfolio design doc.

## Problem

`getErrorMessage()` in `app/src/lib/error-handling.ts` was **raw-by-default**:
when a caller's `matcher` produced nothing it returned `error.message`
verbatim. So any unrecognized failure — the canonical example is a
graduated-market limit order that exceeds the RPC gas cap — dumped a wall of
viem/RPC internals (contract addresses, ABI fragments, library version) straight
into the trade panel. Three harms: unreadable UX that overflows the layout,
zero observability (these errors were shown to users but logged **nowhere** — no
`console.error`, no sink anywhere in the app package), and info-disclosure
(RPC topology, contract layout, server stack messages round-tripping to the
client). The default was inverted: safe should require no effort, raw should
require a deliberate opt-in.

The audit enumerated 11 leak sites in three classes: `getErrorMessage`
fall-through (5 — postgrad swap, limit order, receipt placement, create-market,
wallet), direct `error.message` renders bypassing the util (5 — create-market
service, graduation/dev-market actions, open-orders load, order-book fetch), and
server→client round-trips where API routes returned `{ error: error.message }`
(4 routes, read back by create-market-service). `src/app/error.tsx` was already
the model (friendly copy + opaque `digest`), but did not log.

## Decision / solution

- **Invert the core util to safe-by-default.** `presentError(error, {fallback,
  matcher?, context?})` returns `fallback` for anything unmatched — never a bare
  `error.message`. A shared `KNOWN_ERROR_COPY` allow-list maps common
  cross-cutting reverts (gas cap, user-rejected-in-wallet, insufficient funds,
  chain mismatch, network/timeout) to curated copy so every ticket benefits.
- **Logging folded into the same call.** `presentError` always emits the raw
  error + context to a pluggable sink (`app/src/lib/error-logger.ts`), so
  "shown to the user" and "captured for us" cannot drift apart. v1 ships
  `console.error` + a no-op transport (no vendor commitment; Sentry/logtail
  wired behind the same interface later).
- **Server round-trip fixed.** API routes return a generic client-facing `error`
  string and log raw detail server-side only.
- **Boundary hardened.** `error.tsx` (and a root `global-error.tsx`) now call the
  logger so uncaught render errors are captured, not just displayed.

### Implementation additions (beyond the PRD as written)

- **`DisplayableError` marker class.** The app-wide pass found catch blocks that
  legitimately show exact messages ("Invalid resolutionTime.", the relay-balance
  message) mixed with raw infra errors ("nonce too low"). Blanket suppression
  would have discarded good validation copy. Resolution: code that *means* to
  show an exact string throws `DisplayableError`, which `getErrorMessage` returns
  verbatim; everything else collapses to the curated fallback and is logged.
- **CI guardrail** — `app/src/lib/no-raw-error-render.guardrail.test.ts` fails CI
  if any product file reads a bare `error.message` / `.shortMessage` /
  `String(error)` as a display value. This is what prevents the 11 sites from
  re-accumulating. Unit tests pass at 100% line coverage (the app package's
  enforced bar). Residual risk noted in the doc: the gas-cap repro was verified
  through the formatter functions in unit tests, not against a live devchain.
- **Dev override.** A "Reveal raw errors" toggle in a new top-bar dev menu
  (`app/src/features/dev-settings/`, gated behind
  `NEXT_PUBLIC_POPCHARTS_DEV_TOOLS_ENABLED`) makes `presentError` return raw text
  inline for debugging; it persists in `localStorage` and is inert in production
  because the menu never mounts there. The same menu now hosts the market dev
  actions (Force graduate / Close for refunds) that previously lived behind a
  per-market gear.

## Relationships

- Directly reworks the util that cleanup-program **E3** consolidated
  ([root ADR 0007 cleanup](root-adr-0007-monorepo-architecture-cleanup-program.md)
  put all error-message extraction in `error-handling.ts`; this PRD inverts that
  single home from raw-default to safe-default).
- Enforces the same honesty-and-safety spirit as the
  [product honesty rule](../concepts/product-honesty-rule.md) at the failure
  surface: the UI must not leak mechanism/infra internals any more than it may
  imply a guaranteed fill.
- Leak sites #1–#2 are on the graduated-market trading hot path
  ([postgrad v4 venue](../entities/postgrad-v4-venue.md) tickets).

## Open questions (from the doc)

Logging vendor for v1 (recommendation: console-only now, real service as a fast
follow); who owns curated copy; inline vs toast surfacing (out of scope); whether
the API should emit stable error *codes* the client maps to copy rather than
prose.

## Related pages

- [app/ workspace](../entities/app-workspace.md)
- [Product honesty rule](../concepts/product-honesty-rule.md)
- [Repo ADR 0007 — cleanup program](root-adr-0007-monorepo-architecture-cleanup-program.md)
