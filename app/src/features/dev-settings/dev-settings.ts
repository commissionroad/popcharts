import { setRevealRawErrors } from "@/lib/error-handling";

const REVEAL_STORAGE_KEY = "popcharts:dev:reveal-raw-errors:v1";

/**
 * Whether the dev-tools UI (the top-bar dev menu and its overrides) is
 * available in this build. Gated by the same build-time env flag as the rest of
 * the dev tooling, so none of it can surface in production.
 */
export function devToolsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_POPCHARTS_DEV_TOOLS_ENABLED === "true";
}

/**
 * Reads the persisted "reveal raw errors" preference. SSR-safe (returns `false`
 * on the server, where there is no storage and no user to debug).
 */
export function readRevealRawErrors(): boolean {
  /* v8 ignore next 3 -- SSR guard; unreachable under the jsdom test env. */
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(REVEAL_STORAGE_KEY) === "true";
}

/**
 * Applies the "reveal raw errors" preference: updates the in-memory flag that
 * `presentError` consults (so it takes effect immediately) and persists it for
 * future page loads. Persistence is best-effort — a storage failure leaves the
 * session flag correctly set.
 */
export function setRevealRawErrorsSetting(next: boolean): void {
  setRevealRawErrors(next);

  try {
    window.localStorage.setItem(REVEAL_STORAGE_KEY, next ? "true" : "false");
  } catch {
    // Best effort: the in-memory flag is already updated for this session.
  }
}
