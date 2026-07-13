---
name: ui-pr-verification
description: Verify UI-impacting Pop Charts changes before publishing or updating a PR. Use when changing app pages, routes, components, visual states, browser-visible flows, screenshots, or frontend API wiring, or when asked to prove a UI change locally; also use when preparing a PR description for UI work.
---

# UI PR Verification

This workflow makes UI changes reviewable as behavior, not just code. Prefer the
smallest local setup that exercises the changed user path for real, then put the
evidence in the PR.

## Workflow

1. Identify the user-visible path changed by the work.
   - Prefer a real local stack when the UI depends on server, database, chain,
     wallet, or indexer state.
   - Use fixture-only dev server checks only when the change is purely visual or
     the real dependency is unavailable; say that in the PR.

2. Start the local services needed for that path.
   - Use existing project scripts first: `just local-dev`, `just local-smoke`,
     `pnpm run local:dev`, package `dev` scripts, or the narrow package commands
     already documented in the repo.
   - If ports or long-lived local services conflict, use alternate ports for the
     processes started in this task. Do not kill unrelated user processes unless
     the user approves.
   - Let the stack generate its own env; do not hand-edit env to make a path
     work. See **Match the real environment** below.
   - Keep env values, ports, contract addresses, market IDs, and seeded state in
     notes while testing so the PR can describe what was verified.

3. Exercise the real behavior.
   - Drive the same public API or UI path a user would use.
   - For stateful flows, seed enough real data to cross the relevant threshold or
     edge case. Avoid database-only shortcuts when an indexer, API projection, or
     contract event is part of the user path.
   - Verify both the mutation result and the refreshed UI state.

4. Capture browser evidence.
   - Use the browser tool or Playwright against the running local app.
   - Check the main desktop viewport and a mobile/narrow viewport when layout or
     responsive wrapping could be affected.
   - Check for console errors.
   - Capture a screenshot that shows the new/changed state, not merely the top of
     the page. Use full-page screenshots when the important summary is below the
     fold.

5. Preserve the screenshot.
   - Put small, PR-specific screenshots under `docs/screenshots/` with a
     descriptive name, such as
     `docs/screenshots/graduation-market-detail-local.png`.
   - Commit the screenshot when the PR description should embed a stable raw
     GitHub URL. Do not commit large, noisy, or sensitive screenshots.

6. Update the PR description.
   - Include the ordinary verification commands.
   - Add a `Local Stack Verification` section with the real services, seeded
     state, mutation/API result, and UI state observed.
   - Add a `Screenshot` section with a Markdown image link to the committed
     screenshot or another stable artifact URL.

## Match the real environment

Local verification is only worth anything if it reproduces what a user actually
runs. A check that passes because you changed the environment to make it pass
has verified nothing — and will read as green while the feature is broken in
production or in the stock local stack.

- **Use the stock generated env, not a hand-crafted one.** Start the stack the
  normal way and let it write its own env files (`app/.env.development.local`,
  `server/.env.local-chain`, and friends, produced by
  `scripts/local-dev-control.ts`). Do not add or override variables in an ad-hoc
  `.env.local` to get a path working: if the real stack does not set that
  variable, no user has your configuration.
- **Browser-visible config is the classic trap.** A feature that reads a
  `NEXT_PUBLIC_*` variable in the browser only works if the generated env
  actually exposes it. Local dev sets the server-side `POPCHARTS_INDEXER_API_URL`
  but **not** `NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL`, so browser data reads go
  through a same-origin proxy route (`/api/indexer/*`) whose handler reads the
  server-side variable — see `use-order-book.ts` → `/api/indexer/orderbook`.
  Verify against the env the stack generates, and confirm the exact request path
  the browser makes, not one you wired up by hand. (A portfolio hook that read
  the `NEXT_PUBLIC_` var directly passed a hand-set-env check and shipped broken
  in local dev; PR #159.)
- **If you have to set an env var to make the check pass, that is the finding.**
  Either the stack should set it (fix the stack) or the code should not depend on
  it (fix the code). Surface it in the PR instead of papering over it.

## Final Check

Before finishing, stop only the local processes started for this task, leave
pre-existing services alone, and report any services that intentionally remain
running.
