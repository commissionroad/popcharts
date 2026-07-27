/**
 * Request timeout for every outbound call to a public data source or the local
 * indexer API: generous enough for a cold public endpoint, short enough that an
 * unresponsive source fails the run instead of hanging it.
 */
export const sourceTimeoutMs = 8_000;

// api.weather.gov rejects requests that do not identify their caller.
const sourceUserAgent =
  "popcharts-local-create-market (local development helper)";

/**
 * GETs `url` and parses the JSON body, throwing on any non-2xx status so a
 * caller never builds a market from an error page. `weather: true` sends the
 * geo+json Accept and the descriptive User-Agent api.weather.gov requires.
 */
export async function fetchJson(
  url: string | URL,
  options: { readonly weather?: boolean } = {},
): Promise<unknown> {
  const headers = {
    accept: options.weather
      ? "application/geo+json, application/json"
      : "application/json",
    ...(options.weather ? { "user-agent": sourceUserAgent } : {}),
  };
  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(sourceTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`GET ${response.url} returned ${response.status}.`);
  }

  return response.json();
}
