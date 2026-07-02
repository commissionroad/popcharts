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
  const resolutionUrls = unique([
    request.metadata.resolutionUrl,
    ...(request.metadata.resolutionSources ?? []),
  ])
    .map((source) => source.trim())
    .filter(isHttpUrl);

  for (const resolutionUrl of resolutionUrls) {
    try {
      evidence.push(
        await safeFetchEvidence(resolutionUrl, config, "provided_url"),
      );
    } catch (error) {
      evidence.push({
        domain: "unreachable",
        kind: "provided_url",
        sourceTier: "unreachable",
        summary:
          error instanceof Error ? error.message : "Could not fetch URL.",
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
    resolutionSources: request.metadata.resolutionSources,
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

function unique(values: Array<string | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => Boolean(value))),
  );
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
