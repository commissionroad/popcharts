import { isPlainJsonObject } from "./isPlainJsonObject.js";

/**
 * Response envelope returned by Blockscout-compatible `module`/`action` API
 * endpoints. Fields stay `unknown` because explorers put either strings or
 * nested error objects in `result`.
 */
export type ExplorerApiResponse = {
  readonly result?: unknown;
  readonly status?: unknown;
};

/**
 * Parses explorer JSON while preserving the explorer name in parse errors.
 */
export function parseExplorerJson({
  label,
  text,
}: {
  label: string;
  text: string;
}): ExplorerApiResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label} returned non-JSON response: ${text}`);
  }

  if (!isPlainJsonObject(parsed)) {
    throw new Error(`${label} returned an unexpected JSON payload: ${text}`);
  }

  return parsed;
}
