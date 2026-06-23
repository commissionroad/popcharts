import type { AiReviewConfig } from "./config";
import {
  buildSearchQueries,
  safeFetchEvidence,
  searchWebEvidence,
} from "./safe-web";
import type { EvidenceItem, MarketReviewRequest } from "./types";

export async function collectEvidence({
  config,
  request,
}: {
  config: AiReviewConfig;
  request: MarketReviewRequest;
}): Promise<EvidenceItem[]> {
  const mode = request.options?.internetAccess ?? config.internetAccess;

  if (mode === "off") {
    return [];
  }

  const evidence: EvidenceItem[] = [];
  const resolutionUrl = request.metadata.resolutionUrl?.trim();

  if (resolutionUrl) {
    try {
      evidence.push(
        await safeFetchEvidence(resolutionUrl, config, "provided_url"),
      );
    } catch (error) {
      evidence.push({
        domain: "unreachable",
        kind: "provided_url",
        sourceTier: "unreachable",
        summary: error instanceof Error ? error.message : "Could not fetch URL.",
        url: resolutionUrl,
      });
    }
  }

  if (mode !== "search") {
    return evidence;
  }

  const maxResults =
    request.options?.maxSearchResults ?? config.maxSearchResults;
  const fetchResults =
    request.options?.fetchSearchResults ?? config.fetchSearchResults;
  const queries = buildSearchQueries({
    question: request.metadata.question,
    resolutionCriteria: request.metadata.resolutionCriteria,
  });

  for (const query of queries) {
    try {
      evidence.push(
        ...(await searchWebEvidence({
          config,
          fetchResults,
          maxResults,
          query,
        })),
      );
    } catch (error) {
      evidence.push({
        domain: "search",
        kind: "search_result",
        sourceTier: "unreachable",
        summary:
          error instanceof Error ? error.message : "Could not search the web.",
        url: "https://lite.duckduckgo.com/lite/",
      });
    }
  }

  return evidence;
}
