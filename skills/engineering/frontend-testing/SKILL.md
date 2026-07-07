---
name: frontend-testing
description: Conventions for app/ unit tests — Vitest + React Testing Library patterns, mocking seams, coverage policy, and the jsdom/React-act landmines. Use when writing or reviewing tests under app/src.
---

# Frontend Testing (app/)

How `app/src` is unit-tested. The suite enforces **100% line coverage** via
`coverage.thresholds` in `app/vitest.config.ts` — a new file ships with its
tests, not with a threshold edit. Philosophy follows the repo
[tdd skill](../tdd/SKILL.md): test behavior through public interfaces, mock
only at system boundaries.

## Layout and style

- Tests are colocated: `foo.ts` → `foo.test.ts`, components get `.test.tsx`.
  Browser flows live in `src/tests/e2e/` (Playwright), not here.
- Import `describe/expect/it/vi` explicitly from `vitest`. Helper functions and
  fixture builders go at the **bottom** of the file, below the describes.
- Assert what the user or caller observes: rendered roles/text, returned
  values, thrown messages (assert exact copy — user-facing strings are
  contracts). No snapshot tests. `fireEvent` is the house event tool.
- Market fixtures come from `marketFactory` in `src/test/factories/markets.ts`.

## Where to mock (the seams)

| Boundary | Pattern |
|---|---|
| HTTP | `vi.stubGlobal("fetch", ...)` with a URL→Response map; `vi.unstubAllGlobals()` in `afterEach` |
| Env-driven config module | `vi.hoisted` state object + `vi.mock` factory with **getters** for the module-level consts (see `create-market-service.test.ts`) |
| Wallet context | `vi.mock("@/integrations/wallet/wallet-provider")`; copy the `walletState()` helper shape from `receipt-action.test.ts` |
| wagmi / next-navigation | `vi.mock` just the hooks the subject uses |
| Services (when testing hooks/components) | `vi.mock` the service module; the service itself is tested against fetch/chain elsewhere |
| viem clients | Plain objects with `vi.fn()` reads/writes, cast via `as unknown as PublicClient` |
| Chain event logs | Do **not** mock `parseEventLogs`. Build genuine logs with `encodeEventTopics` + `encodeAbiParameters` (indexed args → topics, rest → data) so the real decoding path runs |

Components with an extracted state hook (`use-*-state.ts`) are tested as thin
shells with the hook mocked; the hook gets its own `renderHook` test driven
through its returned actions — including `receiptAction.onClick`, not internal
handlers.

## Unhappy paths are the point

For every module ask: empty/zero/overflow inputs, unparseable JSON, non-ok
responses with and without readable bodies, thrown non-`Error` values, wallet
disconnected / wrong chain / pending action, contract call succeeds but the
expected event is missing, stale async results after inputs change, storage
quota/corruption. The decision-table style (one `it` per blocking state, or
`it.each`) keeps these exhaustive and readable.

## Coverage policy

- Run `pnpm test:coverage`; browse `coverage/index.html` or grep the text
  table for gaps. Thresholds fail the run (and CI) below the floors.
- The `coverage.exclude` list in `vitest.config.ts` is the only denominator
  lever: provider wiring, page shells (covered by the smoke e2e), type-only
  modules. Every entry needs a comment saying why. Don't add code there to
  dodge a hard test.
- Genuinely unreachable defensive code gets
  `/* v8 ignore next N -- why it is unreachable */` at the site, or stays
  uncovered inside the branch floor with the reasoning recorded in the PR.
  Prove unreachability from the code, not from convenience.

## Landmines (each cost real debugging time)

1. **Never return a promise from a sync `act` callback.**
   `act(() => onClick?.())` returns the handler's promise → React treats the
   act as async, warns "called act(async…) without await", and *every later
   test in the file* can see `result.current === null`. Use a block body:
   `act(() => { void onClick?.(); })`, or `await act(async () => { ... })`.
2. **`vi.useFakeTimers()` breaks React's act flushing** (even with `toFake:
   ["setTimeout"]`). For delayed callbacks, spy on `window.setTimeout` and
   intercept only the delays under test, calling through otherwise (see
   `use-receipt-ticket-state.test.ts`).
3. **jsdom has no `scrollIntoView`** — assign `element.scrollIntoView =
   vi.fn()` before spying; same for other layout APIs.
4. **`vi.restoreAllMocks` only touches `vi.spyOn` spies.** Module-mock
   `vi.fn()`s need `vi.clearAllMocks()` too, and `beforeEach` must re-arm
   every `mockReturnValue` your tests rely on.
5. **Accessible names concatenate.** A trigger button containing a chain badge
   matches `/hardhat local/i` alongside the menu row; disambiguate with exact
   strings.
6. **Module-level env consts don't see `vi.stubEnv`.** Functions that read
   `process.env` at call time do; consts captured at import need the
   getter-mock pattern above.

## Verify before PR

`pnpm run app:check` (prettier, eslint `--max-warnings=0`, typecheck,
abi/api checks, full unit suite with thresholds). New tests that only pass in
isolation are pollution bugs — run the whole file and the full suite.
