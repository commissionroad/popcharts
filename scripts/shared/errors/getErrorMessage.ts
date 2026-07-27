/**
 * The human-readable text of a caught value, for messages a developer reads.
 * Non-Error throws collapse to a fixed string rather than being stringified,
 * so a thrown object can never render as `[object Object]` in a hint.
 */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error.";
}
