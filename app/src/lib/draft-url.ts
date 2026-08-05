/**
 * The `/create` route's draft query parameter, read and written in one place.
 *
 * The studio links to it, the route parses it, and the create flow writes it
 * back once a draft exists — four sites that have to agree on one spelling.
 */
const DRAFT_ID_PARAM = "draft";

/** Link to the create flow for an existing draft (studio "Open", templates). */
export function createDraftHref(draftId: number): string {
  return `/create?${DRAFT_ID_PARAM}=${draftId}`;
}

/**
 * Parses the route's raw `?draft=` value into a draft id, or null when it is
 * absent or not a usable integer — a junk param opens a fresh draft rather
 * than erroring.
 */
export function readDraftIdParam(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);

  return Number.isSafeInteger(parsed) ? parsed : null;
}

/**
 * Names the draft in the address bar, or clears it when there is no draft.
 *
 * Deliberately the native history API rather than `router.replace`: `/create`
 * is force-dynamic and reads `searchParams` on the server, so routing would
 * re-run the server component, hand the page a new `initialDraftId`, and fire
 * the flow's load effect — which overwrites the form with the server copy.
 * Autosave is debounced and pauses while that fetch runs, so anything typed in
 * the window would be both unsaved and overwritten. The App Router supports
 * `history.replaceState` for exactly this and re-renders nothing.
 *
 * `replaceState`, not `pushState`: the id is a correction to where the user
 * already is, not a place they navigated to, and Back should leave the flow
 * rather than land on an empty form that creates a second draft.
 */
export function syncDraftIdInUrl(draftId: number | null): void {
  const url = new URL(window.location.href);
  const current = url.searchParams.get(DRAFT_ID_PARAM);
  const next = draftId === null ? null : String(draftId);

  // Idempotent: opening a draft from the studio already put it in the URL.
  if (current === next) {
    return;
  }

  if (next === null) {
    url.searchParams.delete(DRAFT_ID_PARAM);
  } else {
    url.searchParams.set(DRAFT_ID_PARAM, next);
  }

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
