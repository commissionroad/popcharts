---
name: ui-pr-verification
description: Verify UI-impacting Pop Charts changes before publishing or updating a PR. Use when Codex changes app pages, routes, components, visual states, browser-visible flows, screenshots, frontend API wiring, or asks to prove a UI change locally; also use when preparing a PR description for UI work.
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
   - Put small, PR-specific screenshots under `docs/` with a descriptive name,
     such as `docs/graduation-market-detail-local.png`.
   - Commit the screenshot when the PR description should embed a stable raw
     GitHub URL. Do not commit large, noisy, or sensitive screenshots.

6. Update the PR description.
   - Include the ordinary verification commands.
   - Add a `Local Stack Verification` section with the real services, seeded
     state, mutation/API result, and UI state observed.
   - Add a `Screenshot` section with a Markdown image link to the committed
     screenshot or another stable artifact URL.

## Final Check

Before finishing, stop only the local processes started for this task, leave
pre-existing services alone, and report any services that intentionally remain
running.
