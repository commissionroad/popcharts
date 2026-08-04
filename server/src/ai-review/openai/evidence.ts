import { evidenceItemFromUrl } from "../evidence-item";
import type { EvidenceItem } from "../types";
import type { OpenAiOutputItem } from "./http";

/**
 * Evidence extraction from the OpenAI Responses API's own tool records.
 *
 * The same question `anthropic/evidence.ts` answers for Claude: which URLs did
 * the model's tools actually reach? Only those corroborate a sourceCheck.
 *
 * This provider has a stronger record available than the others.
 * `web_search_call.action.sources` is the complete list of URLs consulted,
 * requested through the `include` parameter — where citations report only what
 * the model chose to reference. Both are read: sources for the full trail,
 * citations for the pages the answer actually leaned on.
 */

/** How much of a citation's context to keep as the audit-trail summary. */
const CITATION_SUMMARY_LIMIT = 500;

export function evidenceFromOpenAiOutput(
  output: OpenAiOutputItem[],
): EvidenceItem[] {
  return dedupeEvidence([
    ...evidenceFromSearchSources(output),
    ...evidenceFromCitations(output),
  ]);
}

/**
 * Reads `web_search_call.action.sources` — the URLs the search itself
 * returned. A call that did not complete is skipped: a failed or in-flight
 * search proves no retrieval, the same rule the Claude Code CLI provider
 * applies to an errored tool result.
 */
function evidenceFromSearchSources(output: OpenAiOutputItem[]) {
  const evidence: EvidenceItem[] = [];

  for (const item of output) {
    if (item.type !== "web_search_call" || item.status !== "completed") {
      continue;
    }

    const sources = item.action?.sources;
    if (!Array.isArray(sources)) {
      continue;
    }

    for (const source of sources) {
      if (typeof source !== "object" || source === null) {
        continue;
      }

      const record = source as Record<string, unknown>;
      const built = evidenceItemFromUrl({
        kind: "search_result",
        summary:
          typeof record.snippet === "string" && record.snippet.trim()
            ? record.snippet.trim().slice(0, CITATION_SUMMARY_LIMIT)
            : "OpenAI web search source.",
        title: typeof record.title === "string" ? record.title : undefined,
        url: typeof record.url === "string" ? record.url : undefined,
      });

      if (built) {
        evidence.push(built);
      }
    }
  }

  return evidence;
}

function evidenceFromCitations(output: OpenAiOutputItem[]) {
  const evidence: EvidenceItem[] = [];

  for (const item of output) {
    if (item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const block of item.content) {
      if (!Array.isArray(block?.annotations)) {
        continue;
      }

      for (const annotation of block.annotations) {
        if (annotation?.type !== "url_citation") {
          continue;
        }

        const built = evidenceItemFromUrl({
          kind: "fetched_page",
          summary: "OpenAI cited source.",
          title: annotation.title,
          url: annotation.url,
        });

        if (built) {
          evidence.push(built);
        }
      }
    }
  }

  return evidence;
}

/** The model's final text, concatenated across output_text blocks. */
export function collectOpenAiText(output: OpenAiOutputItem[]) {
  const parts: string[] = [];

  for (const item of output) {
    if (item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }

    for (const block of item.content) {
      if (block?.type === "output_text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }

  return parts.join("\n");
}

/**
 * One item per URL, preferring a citation over a bare search hit for the same
 * URL: a cited page is one the answer actually leaned on, which is the more
 * useful thing to show in the audit trail.
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
