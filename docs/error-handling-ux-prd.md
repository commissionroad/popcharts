# PRD: Never surface raw errors to users

**Status:** Implemented (2026-07-08)
**Author:** (assigned)
**Date:** 2026-07-08
**Related:** `src/lib/error-handling.ts`, `src/lib/error-logger.ts`, `src/app/error.tsx`

> **Implementation note.** Landed as designed, with one addition that emerged
> during the app-wide pass: a `DisplayableError` marker class. The API-route and
> server-action catch blocks catch *both* intentional, client-safe validation /
> business-rule messages ("Invalid resolutionTime.", "Expected protocolParams
> object.", the relay-balance message) *and* raw infra errors ("nonce too low",
> "connection refused"). Blanket-suppressing everything would have thrown away
> the good validation copy the user explicitly wants shown. So: code that means
> to show an exact message throws `DisplayableError`, which `getErrorMessage`
> returns verbatim; every other error collapses to the curated fallback and is
> logged. A regression guardrail test (`src/lib/no-raw-error-render.guardrail.test.ts`)
> fails CI if any product file reads a bare `error.message` / `.shortMessage` /
> `String(error)` as a display value. All unit tests pass at 100% line coverage.
> Residual risk: the gas-cap repro was verified through the real formatter
> functions in unit tests, not against a live devchain.

> **Follow-up (dev override).** Added a developer escape hatch: a "Reveal raw
> errors" toggle in the new top-bar dev menu (`src/features/dev-settings/`,
> gated behind `NEXT_PUBLIC_POPCHARTS_DEV_TOOLS_ENABLED`). When on, `presentError`
> returns the raw error text inline instead of curated copy, so developers can
> debug without reading the console. It syncs to a module flag `presentError`
> consults and persists in `localStorage`; it is inert in production because the
> menu never mounts there. The same menu now hosts the market dev actions (Force
> graduate / Close for refunds) that previously lived behind a per-market gear.

---

## 1. Problem

When a user action fails, the app frequently renders the **raw underlying error
message** straight into the UI. The clearest example is the graduated-market
ticket: placing a limit order that exceeds the RPC gas cap produces a wall of
viem internals dumped into the trade panel —

> The contract function "createOrder" reverted with the following reason: RPC
> submit: Transaction gas limit is 21000000 and exceeds transaction gas cap of
> 16777216 Contract Call: address: 0x2279… function: createOrder(((address
> currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks),
> bool zeroForOne, int24 tickLower, int24 tickUpper, uint256 amountInMaximum,
> bool enablePartialFill, bytes hookData)) args: {"amountInMaximum":"2700000…"}
> … Docs: https://viem.sh/docs/contract/writeContract Version: viem@2.52.2

This is bad on three axes:

1. **UX** — it is unreadable, it overflows the panel and breaks the layout, and
   it leaks contract addresses, ABIs, and library versions to the user.
2. **Observability** — these errors are shown to the user but **captured
   nowhere**. There is currently no `console.error`, no logging service, and no
   error reporting anywhere in the app package. We are doing the exact opposite
   of what we want: users see the noise, engineers see nothing.
3. **Security / info-disclosure** — raw errors round-trip internal details
   (RPC topology, contract layout, server stack messages) to the client.

### Root cause

`getErrorMessage()` in [`src/lib/error-handling.ts`](../app/src/lib/error-handling.ts)
is **raw-by-default**: it returns `error.message` verbatim whenever the caller's
`matcher` does not produce a friendly string.

```ts
// current behavior — the last line is the leak
const matched = matcher?.(error);
if (matched !== undefined) return matched;
return error.message; // ← raw viem/RPC/stack message goes straight to the UI
```

Every caller inherits "leak unless you remembered to allow-list this exact
error." Because new failure modes (like the gas-cap revert above) are never in
the allow-list, they leak. The default is inverted: **safe should be the
default; showing a raw message should require an explicit, deliberate opt-in.**

---

## 2. Goals

- **G1.** A user never sees a raw error message. Every surface that can display a
  failure shows a **well-formed, human-readable** message from a curated set,
  falling back to a generic friendly message.
- **G2.** Every caught error is **logged** — `console.error` in all
  environments, plus a **pluggable sink** so we can wire a logging/telemetry
  service later without touching call sites.
- **G3.** The safe path is the **default**. Producing user copy from a raw
  message must be an explicit, reviewed decision (allow-list entry), not an
  accident of a missed matcher.
- **G4.** Coverage is **complete** across every point a user can trigger a
  failure: trading (market + limit), pre-graduation receipts, market creation,
  wallet actions, data loads (balances, open orders, order book), and the
  top-level render error boundary.

### Non-goals

- Building a full toast/notification framework. Errors continue to render at
  their current inline surfaces; this PRD changes *what text* they show and
  *whether* they're logged, not the layout system. (A toast system can be a
  follow-up; see §7.)
- Retry/recovery logic, offline handling, or i18n of error copy.
- Changing protocol/server contract revert semantics.

---

## 3. Audit — where raw errors reach users today

All paths below currently surface a raw `error.message`. Grouped by mechanism.

### 3a. `getErrorMessage` fall-through (matcher misses → raw)

| # | Site | Interaction | Matcher coverage | Leaks |
|---|------|-------------|------------------|-------|
| 1 | `features/postgrad-ticket/swap-action.ts:212` `getVenueSwapErrorMessage` | Graduated market **market order** (buy/sell) | price-bound only | gas cap + all other reverts |
| 2 | `features/postgrad-ticket/limit-order-action.ts:56` `getLimitOrderErrorMessage` | Graduated market **limit order** place/cancel | price-bound + a few known selectors | **gas cap (the screenshot)** + everything else |
| 3 | `features/receipt-ticket/receipt-action.ts:168` `getReceiptPlacementErrorMessage` | Pre-graduation **receipt** placement | `MarketDoesNotExist` only | all other reverts |
| 4 | `features/market-create/use-create-market-form-state.ts:283,289` | **Create market** + submit for review | **no matcher at all** | always raw |
| 5 | `integrations/wallet/wallet-utilities.ts:86` `getWalletErrorMessage` | Wallet connect / switch chain / mint pUSD | empty-string only | any non-empty wallet/RPC error |

### 3b. Direct `error.message` render (not even using the util)

| # | Site | Interaction |
|---|------|-------------|
| 6 | `features/market-create/create-market-service.ts:340` | Market metadata save failure |
| 7 | `features/market-detail/graduation-actions.ts:41,70` | Graduate-market action |
| 8 | `features/market-detail/dev-market-actions.ts:33` | Dev market action |
| 9 | `features/postgrad-ticket/use-open-venue-orders.ts:103` | Loading your open orders |
| 10 | `features/order-book/use-order-book.ts:110` | Order-book depth ladder fetch |

### 3c. Server → client round-trip

| # | Site | Interaction |
|---|------|-------------|
| 11 | API routes `app/api/{market-review/submissions, indexer/market-metadata, indexer/orderbook, devchain/markets}/route.ts` return `{ error: error.message }`; `create-market-service.ts:337,347` reads `body.error` and renders it | Any server-side failure round-trips its raw message to the user |

### 3d. Already correct (use as the model)

- `src/app/error.tsx` — the top-level Next error boundary shows friendly copy
  and only an opaque `digest`, never `error.message`. This is the target
  behavior. **Gap:** it does not `console.error`/report the error.

---

## 4. Proposed solution

### 4.1 Invert the core utility to safe-by-default

Rework `src/lib/error-handling.ts` so the **default output is the fallback**, and
a raw message is only ever emitted when an allow-list explicitly deems it safe.
Fold logging into the same call so no site can present an error without also
recording it.

Proposed shape (final signature TBD in implementation):

```ts
type PresentErrorOptions = {
  /** Generic, friendly message shown when nothing more specific matches. Required. */
  fallback: string;
  /** Ordered rules mapping a recognized error to safe, curated copy. */
  matcher?: (error: Error) => string | undefined;
  /** Structured context for the log sink: operation, marketId, wallet, etc. */
  context?: Record<string, unknown>;
};

// Always logs (console.error + sink). Never returns a raw error.message
// unless the matcher deliberately returned one.
export function presentError(error: unknown, opts: PresentErrorOptions): string;
```

Key differences from today:

- **No implicit `return error.message`.** Unmatched errors return `fallback`.
- **Logging is not optional and not a separate call.** `presentError` always
  emits the raw error + context to the logger, so "shown to the user" and
  "captured for us" can't drift apart.
- A curated shared allow-list (`KNOWN_ERROR_COPY`) maps common cross-cutting
  reverts (gas cap, user-rejected-in-wallet, insufficient funds, chain
  mismatch, network/timeout) to friendly copy, so every ticket benefits without
  re-listing them.

> Migration note: `getErrorMessage`'s current default (return raw) is relied on
> by ~7 call sites. Inverting it is a behavior change for all of them — that is
> the point. Each site in §3 must be re-checked so its `fallback` reads well.

### 4.2 A logging sink

Add `src/lib/error-logger.ts` (naming TBD):

- `logError(error: unknown, context?: Record<string, unknown>)`:
  - Always `console.error` with the raw error and context.
  - Forwards to a **pluggable transport**. Default transport is a no-op (or
    console-only) so nothing external is required to ship; a real service
    (Sentry / logtail / custom `/api/telemetry`) is wired behind the same
    interface later. This satisfies "we can even collect the errors to a
    logging service" without committing to a vendor now.
- Redaction pass so we never log wallet private data; addresses are fine.

**Open question (needs a decision):** which logging service, if any, in v1 — see
§8.

### 4.3 Fix the server round-trip

API routes must return a **generic** `error` string to the client (safe to
display) and `console.error`/log the raw detail server-side. The client stops
being able to receive a raw server message at all. (Sites #11.)

### 4.4 Harden the top-level boundary

Keep `src/app/error.tsx` copy as-is (it's the model), but have it call
`logError` so uncaught render errors are captured, not just displayed. Confirm a
`global-error.tsx` exists for the root layout too, or add one.

---

## 5. Scope of work (implementation checklist)

1. **Core util** — invert `error-handling.ts` to safe-by-default; add shared
   `KNOWN_ERROR_COPY` (gas cap, user-rejected, insufficient funds, chain
   mismatch, network). Update `error-handling.test.ts` (100% line coverage is
   enforced in this package).
2. **Logger** — add `error-logger.ts` with `console.error` + pluggable no-op
   transport; unit-test the redaction and the sink dispatch.
3. **Migrate §3a callers** (5) to the new util; verify each `fallback` reads as
   product copy, not a stack trace.
4. **Migrate §3b direct renders** (5) to route through the util + logger.
5. **Fix §3c API routes** (4 routes + the 2 client read points) to return and
   render only generic copy.
6. **Boundary** (§3d) — add `logError` to `error.tsx`; ensure a
   `global-error.tsx`.
7. **Guardrail** — add a lint rule / test that fails CI if `error.message` (or
   `.shortMessage`/`String(error)`) is passed into JSX or into a `setError`-style
   state setter outside the sanctioned util. Prevents regressions (this is how
   the 11 sites accumulated).
8. **Verify** — reproduce the screenshot (place a limit order that exceeds the
   gas cap on the local devchain) and confirm the panel shows friendly copy, the
   raw error is in the console, and the layout no longer breaks. Capture a
   before/after screenshot per the UI-PR-verification skill.

---

## 6. Acceptance criteria

- **AC1.** Reproducing the gas-cap limit order shows a short friendly message
  (e.g. "This order is too large to place right now. Try a smaller size.") and
  does not overflow the panel.
- **AC2.** The raw viem error for AC1 appears in `console.error` with context
  (operation, market id).
- **AC3.** Grep proves no product component or hook passes a raw `error.message`
  / `.shortMessage` / `String(error)` into rendered output or error state; the
  only raw-message emission is inside a sanctioned matcher allow-list entry.
- **AC4.** Every §3 site renders a curated or fallback message for an
  unrecognized error, verified by a unit test feeding it an arbitrary `Error`.
- **AC5.** API routes return generic client-facing errors; raw detail is logged
  server-side only.
- **AC6.** CI guardrail (§5.7) fails on a newly introduced raw-error render.

---

## 7. Rollout

Single PR is feasible (util + ~15 call sites + tests) but reviews more cleanly
split as: (a) core util + logger + tests, (b) trading/receipt/wallet migrations,
(c) create-market + API routes, (d) boundary + CI guardrail. Behind no feature
flag — this is strictly safer output. Coordinate with the postgrad trading
production-risk watchlist since sites #1–#2 are on the hot path.

---

## 8. Open questions

1. **Logging service for v1?** Ship with console-only + a no-op transport (fast,
   zero deps), or wire a real service (Sentry?) now? Recommendation:
   console-only transport in this PR, real service as a fast follow so this
   isn't blocked on vendor choice.
2. **Curated copy ownership** — who signs off on the user-facing strings? Draft
   in-PR, or route through product/design first?
3. **Toast vs inline** — keep errors inline (current) or introduce a toast for
   transient action failures? Out of scope here; flag if desired.
4. **Server error taxonomy** — do we want stable error *codes* from the API
   (client maps code → copy) rather than the API sending prose at all? Cleaner
   long-term; larger change.
