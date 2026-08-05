/**
 * The `/create` route's draft query parameter, read and written in one place.
 *
 * The studio links to it, the route parses it, and the create flow writes it
 * back once a draft exists — four sites that have to agree on one spelling.
 */
const DRAFT_ID_PARAM = "draft";

/**
 * Widest a draft id may be before the app stops treating it as one. The exact
 * format — length, alphabet — is the server's to define and enforce; this is
 * only a sanity bound so a pasted essay never becomes a request path.
 */
const MAX_DRAFT_ID_LENGTH = 64;

/** Link to the create flow for an existing draft (studio "Open", templates). */
export function createDraftHref(draftId: string): string {
  return `/create?${DRAFT_ID_PARAM}=${encodeURIComponent(draftId)}`;
}

/**
 * Narrows the route's raw `?draft=` value to a usable draft id, or null when
 * it is absent or obviously not one.
 *
 * Deliberately not a format check: the id's alphabet and length belong to the
 * server (`src/drafts/public-id.ts`), and restating them here would be a
 * second definition to drift out of step. Anything that survives this is
 * handed to the API, which is the authority — an id that does not exist comes
 * back not-found and the flow starts fresh.
 */
export function readDraftIdParam(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();

  if (trimmed.length === 0 || trimmed.length > MAX_DRAFT_ID_LENGTH) {
    return null;
  }

  return trimmed;
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
export function syncDraftIdInUrl(draftId: string | null): void {
  const url = new URL(window.location.href);
  const current = url.searchParams.get(DRAFT_ID_PARAM);

  // Idempotent: opening a draft from the studio already put it in the URL.
  if (current === draftId) {
    return;
  }

  if (draftId === null) {
    url.searchParams.delete(DRAFT_ID_PARAM);
  } else {
    url.searchParams.set(DRAFT_ID_PARAM, draftId);
  }

  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}
