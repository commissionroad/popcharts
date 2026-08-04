import { collectText, evidenceFromContent } from "./anthropic/evidence";
import { callAnthropicMessages } from "./anthropic/http";
import { buildAnthropicTools } from "./anthropic/tools";
import type { AiReviewConfig } from "./config";
import {
  adjustModelScoresForEvidence,
  alignScoreRationalesWithAdjustedScores,
  arrayOfStrings,
  filterSourceChecksByEvidence,
  parseModelReview,
  parseScoreRationales,
  parseSourceChecks,
  parseVerdict,
} from "./response-parsing";
import { normalizeScores } from "./scoring";
import {
  buildSuppliedEvidenceSystemPrompt,
  buildSuppliedEvidenceUserMessage,
} from "./supplied-evidence";
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
  evidence: suppliedEvidence = [],
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
    | "evidenceMode"
    | "internetAccess"
    | "requestTimeoutMs"
  >;
  evidence?: EvidenceItem[];
  model?: string;
  request: MarketReviewRequest;
}): Promise<AnthropicReview> {
  if (!config.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for Anthropic review.");
  }

  const modelId = model ?? config.anthropicModel;
  const mode = request.options?.internetAccess ?? config.internetAccess;
  // In precollected mode the model gets the evidence and no tools, so a
  // comparison against other providers varies only the model — not which web
  // tools each API happens to offer.
  const precollected = config.evidenceMode === "precollected";
  const response = await callAnthropicMessages({
    config,
    model: modelId,
    request,
    ...(precollected
      ? {
          system: buildSuppliedEvidenceSystemPrompt(),
          userContent: buildSuppliedEvidenceUserMessage({
            evidence: suppliedEvidence,
            request,
          }),
          tools: [],
        }
      : { tools: buildAnthropicTools({ config, mode, request }) }),
  });
  const content = response.content ?? [];
  const parsed = parseModelReview(collectText(content), "Anthropic");
  const evidence = precollected
    ? suppliedEvidence
    : evidenceFromContent(content);
  const sourceChecks = filterSourceChecksByEvidence(
    parseSourceChecks(parsed.sourceChecks),
    evidence,
  );
  const hardFlags = arrayOfStrings(parsed.hardFlags);
  const rawScores = normalizeScores(
    typeof parsed.scores === "object" && parsed.scores !== null
      ? (parsed.scores as Record<string, unknown>)
      : {},
  );
  const scores = adjustModelScoresForEvidence(
    rawScores,
    sourceChecks,
    hardFlags,
  );
  const scoreRationales = alignScoreRationalesWithAdjustedScores({
    adjustedScores: scores,
    rationales: parseScoreRationales(parsed.scoreRationales),
    rawScores,
    sourceChecks,
  });

  return {
    evidence,
    hardFlags,
    modelId: response.model ?? modelId,
    reasons: arrayOfStrings(parsed.reasons),
    scoreRationales,
    scores,
    sourceChecks,
    verdict: parseVerdict(parsed.verdict),
  };
}
