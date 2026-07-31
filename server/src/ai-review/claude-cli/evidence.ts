import { evidenceItemFromUrl } from "../evidence-item";
import type { EvidenceItem } from "../types";
import type { ClaudeCliStream, ClaudeCliToolUse } from "./stream";

/**
 * Evidence extraction from the Claude Code CLI's tool records.
 *
 * This is the CLI provider's answer to the same question `anthropic/evidence.ts`
 * answers for the API provider: which URLs did the model's tools actually
 * reach? Only those corroborate a sourceCheck. A tool_use on its own proves
 * nothing — the model chose its arguments — so a URL is credited only when the
 * CLI also recorded a non-error result for that invocation.
 */

/** How much of a fetched page to keep as the audit-trail summary. */
const FETCH_SUMMARY_LIMIT = 500;

export function evidenceFromClaudeCliStream(
  stream: ClaudeCliStream,
): EvidenceItem[] {
  const resultsByToolUseId = new Map(
    stream.toolResults.map((result) => [result.toolUseId, result]),
  );
  const evidence: EvidenceItem[] = [];

  for (const toolUse of stream.toolUses) {
    const result = resultsByToolUseId.get(toolUse.id);
    // No result, or a failed one (403, DNS failure, timeout): the URL was
    // never retrieved, so it earns no credit.
    if (!result || result.isError) {
      continue;
    }

    if (toolUse.name === "WebSearch") {
      evidence.push(...evidenceFromSearchResult(result.content));
      continue;
    }

    if (toolUse.name === "WebFetch") {
      const item = evidenceFromFetch(toolUse, result.content);
      if (item) {
        evidence.push(item);
      }
    }
  }

  return dedupeEvidence(evidence);
}

/**
 * Reads the links WebSearch itself returned. The result payload is a text
 * blob whose second line is `Links: [{"title":…,"url":…},…]`, followed by the
 * fetched page text — attacker-controlled content that can contain anything,
 * including text shaped like a link record. Only the first `Links: [` array is
 * read, and only as JSON, so page text can never add a URL to the evidence
 * trail.
 */
function evidenceFromSearchResult(content: string): EvidenceItem[] {
  const links = parseSearchLinks(content);
  const evidence: EvidenceItem[] = [];

  for (const link of links) {
    const item = evidenceItemFromUrl({
      kind: "search_result",
      summary: "Claude Code web search result.",
      title: typeof link.title === "string" ? link.title : undefined,
      url: typeof link.url === "string" ? link.url : undefined,
    });

    if (item) {
      evidence.push(item);
    }
  }

  return evidence;
}

function evidenceFromFetch(toolUse: ClaudeCliToolUse, content: string) {
  return evidenceItemFromUrl({
    kind: "fetched_page",
    summary: content.trim()
      ? `Claude Code web fetch result. ${content.trim().slice(0, FETCH_SUMMARY_LIMIT)}`
      : "Claude Code web fetch result.",
    url: typeof toolUse.input.url === "string" ? toolUse.input.url : undefined,
  });
}

const SEARCH_LINKS_MARKER = "Links: ";

function parseSearchLinks(content: string): Record<string, unknown>[] {
  const markerAt = content.indexOf(SEARCH_LINKS_MARKER);
  if (markerAt === -1) {
    return [];
  }

  const arrayAt = markerAt + SEARCH_LINKS_MARKER.length;
  if (content[arrayAt] !== "[") {
    return [];
  }

  const arrayEnd = findArrayEnd(content, arrayAt);
  if (arrayEnd === -1) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(content.slice(arrayAt, arrayEnd + 1));
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null,
        )
      : [];
  } catch {
    return [];
  }
}

/**
 * Index of the `]` closing the array that opens at `start`. Brackets inside
 * JSON strings are skipped, so a page title containing "]" cannot truncate the
 * array early.
 */
function findArrayEnd(content: string, start: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index += 1) {
    const character = content[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (inString) {
      if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "[") {
      depth += 1;
    } else if (character === "]") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

/**
 * One item per URL, preferring a fetched page over a search hit for the same
 * URL because the fetch carries the page's own text as its summary.
 */
function dedupeEvidence(evidence: EvidenceItem[]) {
  const byUrl = new Map<string, EvidenceItem>();

  for (const item of evidence) {
    const existing = byUrl.get(item.url);
    if (
      !existing ||
      (existing.kind !== "fetched_page" && item.kind === "fetched_page")
    ) {
      byUrl.set(item.url, item);
    }
  }

  return Array.from(byUrl.values());
}
