/**
 * Parses explorer JSON while preserving the explorer name in parse errors.
 */
export function parseExplorerJson({ label, text }) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON response: ${text}`);
  }
}
