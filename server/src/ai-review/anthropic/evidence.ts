import { sourceTierForDomain } from "../scoring";
import type { EvidenceItem } from "../types";
import type {
  AnthropicContentBlock,
  AnthropicTextBlock,
  AnthropicWebFetchResult,
} from "./http";

export function collectText(content: AnthropicContentBlock[]) {
  return content
    .filter((block): block is AnthropicTextBlock => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

export function evidenceFromContent(content: AnthropicContentBlock[]) {
  return dedupeEvidence([
    ...evidenceFromSearchResults(content),
    ...evidenceFromFetchResults(content),
    ...evidenceFromCitations(content),
  ]);
}

function evidenceFromSearchResults(content: AnthropicContentBlock[]) {
  const evidence: EvidenceItem[] = [];

  for (const block of content) {
    if (
      block.type !== "web_search_tool_result" ||
      !Array.isArray(block.content)
    ) {
      continue;
    }

    for (const result of block.content) {
      const item = evidenceFromUrl({
        kind: "search_result",
        summary: result.page_age
          ? `Claude web search result. Page age: ${result.page_age}.`
          : "Claude web search result.",
        title: result.title,
        url: result.url,
      });

      if (item) {
        evidence.push(item);
      }
    }
  }

  return evidence;
}

function evidenceFromFetchResults(content: AnthropicContentBlock[]) {
  const evidence: EvidenceItem[] = [];

  for (const block of content) {
    const result =
      block.type === "web_fetch_tool_result" ? block.content : null;
    if (block.type !== "web_fetch_tool_result" || !isWebFetchResult(result)) {
      continue;
    }

    const item = evidenceFromUrl({
      kind: "fetched_page",
      summary: result.retrieved_at
        ? `Claude web fetch result retrieved at ${result.retrieved_at}.`
        : "Claude web fetch result.",
      title: result.content?.title,
      url: result.url,
    });

    if (item) {
      evidence.push(item);
    }
  }

  return evidence;
}

function evidenceFromCitations(content: AnthropicContentBlock[]) {
  const evidence: EvidenceItem[] = [];

  for (const block of content) {
    if (block.type !== "text" || !Array.isArray(block.citations)) {
      continue;
    }

    for (const citation of block.citations) {
      const item = evidenceFromUrl({
        kind: "search_result",
        summary: citation.cited_text ?? "Claude cited source.",
        title: citation.title,
        url: citation.url,
      });

      if (item) {
        evidence.push(item);
      }
    }
  }

  return evidence;
}

function evidenceFromUrl({
  kind,
  summary,
  title,
  url,
}: {
  kind: EvidenceItem["kind"];
  summary: string;
  title?: string;
  url?: string;
}) {
  const parsed = parseHttpUrl(url);
  if (!parsed) {
    return null;
  }

  const domain = parsed.hostname.toLowerCase();
  return {
    domain,
    kind,
    sourceTier: sourceTierForDomain(domain),
    summary,
    title,
    url: parsed.toString(),
  } satisfies EvidenceItem;
}

function dedupeEvidence(evidence: EvidenceItem[]) {
  const byUrl = new Map<string, EvidenceItem>();
  for (const item of evidence) {
    const existing = byUrl.get(item.url);
    if (!existing || shouldReplaceEvidence(existing, item)) {
      byUrl.set(item.url, item);
    }
  }

  return Array.from(byUrl.values());
}

function shouldReplaceEvidence(existing: EvidenceItem, next: EvidenceItem) {
  if (
    existing.summary.startsWith("Claude web search result") &&
    !next.summary.startsWith("Claude web search result")
  ) {
    return true;
  }

  return existing.summary.length < next.summary.length;
}

function isWebFetchResult(value: unknown): value is AnthropicWebFetchResult {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { type?: unknown }).type === "web_fetch_result"
  );
}

export function domainFromUrl(value?: string) {
  return parseHttpUrl(value)?.hostname.toLowerCase();
}

function parseHttpUrl(value?: string) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }

    url.hash = "";
    return url;
  } catch {
    return null;
  }
}
