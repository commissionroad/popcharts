/**
 * Narrows an unknown value to an indexable object so JSON that crossed a
 * boundary — a request body, an API response, a serialized param bag — can be
 * read key by key without `any`. Arrays satisfy it, matching a bare `typeof`
 * check: callers that must reject an array test `Array.isArray` themselves.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
