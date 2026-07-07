import { collectText, evidenceFromContent } from "./anthropic/evidence";
import { callAnthropicMessages } from "./anthropic/http";
import { buildAnthropicTools } from "./anthropic/tools";
import type { AiReviewConfig } from "./config";
import {
  adjustModelScoresForEvidence,
  arrayOfStrings,
  filterSourceChecksByEvidence,
  parseModelReview,
  parseSourceChecks,
  parseVerdict,
} from "./response-parsing";
import { normalizeScores } from "./scoring";
import type { EvidenceItem, MarketReviewRequest, PolicyFinding } from "./types";

/**
 * An Anthropic policy finding plus the evidence extracted from Claude's own
 * web search/fetch tool results and citations, and the model id that actually
 * answered.
 */
export type AnthropicReview = PolicyFinding & {
  evidence: EvidenceItem[];
  modelId: string;
};

/**
 * Reviews a market with Claude, using Anthropic's native web_search/web_fetch
 * tools instead of pre-collected evidence; web_fetch is restricted to the
 * submitter's resolution domains. Model output is treated as untrusted: scores
 * are clamped, an unrecognized verdict falls back to manual_review, and
 * sourceChecks that do not match tool-result evidence are discarded so the
 * model cannot invent corroborating sources.
 */
export async function reviewWithAnthropic({
  config,
  model,
  request,
}: {
  config: Pick<
    AiReviewConfig,
    | "anthropicApiKey"
    | "anthropicBaseUrl"
    | "anthropicMaxOutputTokens"
    | "anthropicMaxWebFetches"
    | "anthropicMaxWebSearches"
    | "anthropicModel"
    | "anthropicWebFetchMaxContentTokens"
    | "internetAccess"
    | "requestTimeoutMs"
  >;
  model?: string;
  request: MarketReviewRequest;
}): Promise<AnthropicReview> {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for Anthropic review.");
  }

  const modelId = model ?? config.anthropicModel;
  const mode = request.options?.internetAccess ?? config.internetAccess;
  const response = await callAnthropicMessages({
    config,
    model: modelId,
    request,
    tools: buildAnthropicTools({ config, mode, request }),
  });
  const content = response.content ?? [];
  const parsed = parseModelReview(collectText(content), "Anthropic");
  const evidence = evidenceFromContent(content);
  const sourceChecks = filterSourceChecksByEvidence(
    parseSourceChecks(parsed.sourceChecks),
    evidence,
  );
  const hardFlags = arrayOfStrings(parsed.hardFlags);
  const scores = adjustModelScoresForEvidence(
    normalizeScores(
      typeof parsed.scores === "object" && parsed.scores !== null
        ? (parsed.scores as Record<string, unknown>)
        : {},
    ),
    sourceChecks,
    hardFlags,
  );

  return {
    evidence,
    hardFlags,
    modelId: response.model ?? modelId,
    reasons: arrayOfStrings(parsed.reasons),
    scores,
    sourceChecks,
    verdict: parseVerdict(parsed.verdict),
  };
}
