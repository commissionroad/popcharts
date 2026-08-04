import { buildCliReviewPrompt } from "./cli-support";
import type { AiReviewConfig } from "./config";
import { collectOpenAiText, evidenceFromOpenAiOutput } from "./openai/evidence";
import { callOpenAiResponses } from "./openai/http";
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
import type { EvidenceItem, MarketReviewRequest, PolicyFinding } from "./types";

/**
 * An OpenAI policy finding plus the evidence extracted from the Responses
 * API's own web-search records, and the model that answered.
 */
export type OpenAiReview = PolicyFinding & {
  evidence: EvidenceItem[];
  modelId: string;
};

/**
 * Reviews a market with an OpenAI model using the Responses API's native web
 * search. Model output is untrusted: scores are clamped, an unrecognized
 * verdict falls back to manual_review, and sourceChecks that do not match the
 * URLs the search actually returned are discarded.
 *
 * The prompt is the one the CLI providers use. That is deliberate rather than
 * incidental: an eval comparing providers has to vary the backend and nothing
 * else, and a second copy of the policy would drift out of step with the first
 * the next time the policy is tuned.
 */
export async function reviewWithOpenAi({
  config,
  model,
  request,
}: {
  config: Pick<
    AiReviewConfig,
    | "internetAccess"
    | "openaiApiKey"
    | "openaiBaseUrl"
    | "openaiMaxOutputTokens"
    | "openaiModel"
    | "requestTimeoutMs"
  >;
  model?: string;
  request: MarketReviewRequest;
}): Promise<OpenAiReview> {
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is required for OpenAI review.");
  }

  const modelId = model ?? config.openaiModel;
  const mode = request.options?.internetAccess ?? config.internetAccess;
  const response = await callOpenAiResponses({
    config,
    input: buildCliReviewPrompt(request),
    model: modelId,
    webSearchEnabled: mode !== "off",
  });

  const output = response.output ?? [];
  const parsed = parseModelReview(collectOpenAiText(output), "OpenAI");
  const evidence = evidenceFromOpenAiOutput(output);
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
