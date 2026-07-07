/**
 * App-facing market identifiers. The app addresses a market as
 * "chainId:marketId" — a URL-path encoding scheme, not a domain concept —
 * so the composer and parser live here rather than in `src/domain/`.
 */

/**
 * Builds the app-facing id ("chainId:marketId") for a market. Accepts any
 * object carrying the two fields, e.g. an `ApiMarket`.
 */
export function apiMarketAppId({
  chainId,
  marketId,
}: {
  chainId: number;
  marketId: string;
}) {
  return `${chainId}:${marketId}`;
}

/**
 * Parses an app-facing market id ("chainId:marketId", possibly still
 * URL-encoded from a route path) back into its parts. Returns null when the
 * id is missing a part, has extra segments, or has a non-numeric chain id.
 */
export function parseApiMarketAppId(id: string) {
  const decodedId = decodePathSegment(id);
  const [chainIdValue, marketId, ...rest] = decodedId.split(":");
  const chainId = Number.parseInt(chainIdValue ?? "", 10);

  if (!chainIdValue || !marketId || rest.length > 0 || Number.isNaN(chainId)) {
    return null;
  }

  return { chainId, marketId };
}

function decodePathSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
