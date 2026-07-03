/**
 * Converts explorer result payloads into readable status or error text.
 */
export function normalizeExplorerMessage(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}
