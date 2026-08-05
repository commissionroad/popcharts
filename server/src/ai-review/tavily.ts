import type { AiReviewConfig } from "./config";
import { evidenceItemFromUrl } from "./evidence-item";
import type { EvidenceItem } from "./types";

/**
 * Search-backed evidence from Tavily, an alternative to the DuckDuckGo Lite
 * scrape in safe-web.ts.
 *
 * The difference that matters is not result quality but where the fetching
 * happens. The DuckDuckGo path returns links only, so confirming a source
 * means this service fetching each page itself — measured at roughly four
 * fifths of a review's wall clock, and enough to push a local-model review
 * past the 300s request timeout. Tavily returns a `content` snippet inline
 * with every hit, so the review needs no outbound page fetches at all.
 *
 * That also shrinks the attack surface. Every URL our own fetcher visits is a
 * URL chosen, directly or indirectly, by untrusted market text; not visiting
 * them removes that class of request rather than guarding it.
 *
 * Verified against the Tavily search API reference (POST /search).
 */

/** How much of a result's snippet to keep as the audit-trail summary. */
const SNIPPET_LIMIT = 500;

type TavilyResult = {
  content?: unknown;
  raw_content?: unknown;
  title?: unknown;
  url?: unknown;
};

export async function searchTavilyEvidence({
  config,
  maxResults,
  query,
}: {
  config: Pick<
    AiReviewConfig,
    "requestTimeoutMs" | "tavilyApiKey" | "tavilyBaseUrl" | "tavilySearchDepth"
  >;
  maxResults: number;
  query: string;
}): Promise<EvidenceItem[]> {
  if (!config.tavilyApiKey) {
    throw new Error("TAVILY_API_KEY is required for Tavily search.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const response = await fetch(new URL("/search", config.tavilyBaseUrl), {
      body: JSON.stringify({
        // Tavily caps max_results at 20; asking for more is a 400 rather than
        // a silent clamp, so it is clamped here.
        max_results: Math.min(Math.max(maxResults, 1), 20),
        query,
        search_depth: config.tavilySearchDepth,
      }),
      headers: {
        authorization: `Bearer ${config.tavilyApiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(
        `Tavily search failed with HTTP ${response.status}: ${truncate(
          await response.text().catch(() => ""),
          300,
        )}`,
      );
    }

    return evidenceFromTavilyResponse(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Narrows an untrusted Tavily response into evidence. Results run through the
 * same `evidenceItemFromUrl` every other provider uses, so a non-http or
 * internal-network URL is dropped here exactly as it would be from a model's
 * own tool records.
 */
export function evidenceFromTavilyResponse(payload: unknown): EvidenceItem[] {
  const results =
    typeof payload === "object" && payload !== null
      ? (payload as { results?: unknown }).results
      : undefined;

  if (!Array.isArray(results)) {
    return [];
  }

  const evidence: EvidenceItem[] = [];

  for (const result of results) {
    if (typeof result !== "object" || result === null) {
      continue;
    }

    const record = result as TavilyResult;
    const snippet =
      typeof record.content === "string" && record.content.trim()
        ? record.content.trim()
        : typeof record.raw_content === "string"
          ? record.raw_content.trim()
          : "";

    const item = evidenceItemFromUrl({
      // fetched_page rather than search_result: unlike a bare listing, a
      // Tavily hit carries the page's own text, which is what a fetch would
      // have produced.
      kind: snippet ? "fetched_page" : "search_result",
      summary: snippet
        ? snippet.slice(0, SNIPPET_LIMIT)
        : "Tavily search result.",
      title: typeof record.title === "string" ? record.title : undefined,
      url: typeof record.url === "string" ? record.url : undefined,
    });

    if (item) {
      evidence.push(item);
    }
  }

  return evidence;
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
