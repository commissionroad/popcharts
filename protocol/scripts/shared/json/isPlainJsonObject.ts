/**
 * Narrows parsed JSON to a plain object so callers can read fields from
 * `unknown` without casts at the parse boundary.
 */
export function isPlainJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
