import { sourceTimeoutMs } from "../net/fetchJson.ts";
import { resolveApiUrl } from "../net/resolveApiUrl.ts";
import type { MarketMetadata } from "./generatedMarket.ts";

/**
 * Saves a created market's metadata to the local indexer API under the metadata
 * hash the chain recorded, which is the only key linking the two. Optional
 * fields are omitted rather than sent empty so the stored payload matches what
 * was hashed. Throws with the API's own response text on any non-2xx, since a
 * market whose metadata never landed renders as an unlabelled row.
 */
export async function persistMarketMetadata(args: {
  readonly apiBaseUrl: string;
  readonly chainId: number;
  readonly metadata: MarketMetadata;
  readonly metadataHash: string;
}): Promise<void> {
  const { apiBaseUrl, chainId, metadata, metadataHash } = args;
  const response = await fetch(
    resolveApiUrl({
      baseUrl: apiBaseUrl,
      path: `markets/${chainId}/metadata`,
    }),
    {
      body: JSON.stringify({
        category: metadata.category,
        createdAt: metadata.createdAt,
        description: metadata.description,
        metadataHash,
        question: metadata.question,
        resolutionCriteria: metadata.resolutionCriteria,
        ...(metadata.resolutionSources?.length
          ? { resolutionSources: metadata.resolutionSources }
          : {}),
        ...(metadata.resolutionUrl
          ? { resolutionUrl: metadata.resolutionUrl }
          : {}),
      }),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(sourceTimeoutMs),
    },
  );

  if (response.ok) {
    return;
  }

  const body = await response.text().catch(() => "");
  throw new Error(
    `POST ${response.url} returned ${response.status}${
      body ? `: ${body.slice(0, 240)}` : ""
    }`,
  );
}
