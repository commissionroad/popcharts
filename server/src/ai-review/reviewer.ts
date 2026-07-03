import { AI_REVIEW_PROMPT_VERSION, type AiReviewConfig } from "./config";
import { collectEvidence } from "./evidence";
import { runHeuristicPolicy } from "./heuristics";
import { mergeReviewFindings } from "./ollama";
import { getReviewProvider } from "./providers/registry";
import type {
  MarketReviewRequest,
  PolicyFindingWithEvidence,
  ReviewProviderName,
  ReviewResult,
} from "./types";

/**
 * Runs the full market review pipeline and always returns a usable verdict.
 * The deterministic heuristic pass runs first and its reject is final — no
 * model output can overturn a hard flag. Provider errors degrade to the
 * heuristic finding with an approve downgraded to manual_review, so an outage
 * can never silently approve a market.
 */
export async function reviewMarket({
  config,
  request,
}: {
  config: AiReviewConfig;
  request: MarketReviewRequest;
}): Promise<ReviewResult> {
  const heuristic = runHeuristicPolicy(request.metadata);

  if (heuristic.verdict === "reject") {
    return mergeReviewFindings({
      evidence: [],
      heuristic,
      promptVersion: AI_REVIEW_PROMPT_VERSION,
    });
  }

  const providerName = request.options?.provider ?? config.provider;
  const provider = getReviewProvider(providerName);

  let evidence: ReviewResult["evidence"] = [];

  if (provider.capabilities.requiresPreCollectedEvidence) {
    evidence = await collectEvidence({ config, request });
  }

  try {
    const validation = provider.validateConfig(config);
    if (validation.errors.length > 0) {
      throw new Error(validation.errors.join(" "));
    }

    const providerReview = await provider.review({
      config,
      evidence,
      model: request.options?.model,
      heuristic,
      request,
    });

    return buildReviewResult({
      heuristic,
      providerName,
      providerReview,
    });
  } catch (error) {
    return modelUnavailableReview({
      error,
      evidence,
      heuristic,
      providerName,
    });
  }
}

function buildReviewResult({
  heuristic,
  providerName,
  providerReview,
}: {
  heuristic: ReturnType<typeof runHeuristicPolicy>;
  providerName: ReviewProviderName;
  providerReview: PolicyFindingWithEvidence;
}) {
  return mergeReviewFindings({
    evidence: providerReview.evidence,
    heuristic,
    model: providerName === "heuristic" ? undefined : providerReview,
    modelId: providerReview.modelId,
    modelProvider: providerName,
    promptVersion: AI_REVIEW_PROMPT_VERSION,
  });
}

function modelUnavailableReview({
  error,
  evidence = [],
  heuristic,
  providerName,
}: {
  error: unknown;
  evidence?: ReviewResult["evidence"];
  heuristic: ReturnType<typeof runHeuristicPolicy>;
  providerName: ReviewProviderName;
}): ReviewResult {
  return {
    evidence,
    hardFlags: heuristic.hardFlags,
    promptVersion: AI_REVIEW_PROMPT_VERSION,
    provider: "heuristic",
    reasons: [
      ...heuristic.reasons,
      error instanceof Error
        ? `${displayProviderName(providerName)} review unavailable: ${error.message}`
        : `${displayProviderName(providerName)} review unavailable.`,
    ],
    scores: {
      ...heuristic.scores,
      disputeRisk: Math.max(heuristic.scores.disputeRisk, 4),
    },
    sourceChecks: heuristic.sourceChecks,
    verdict:
      heuristic.verdict === "approve" ? "manual_review" : heuristic.verdict,
  };
}

function displayProviderName(providerName: ReviewProviderName) {
  if (providerName === "anthropic") {
    return "Anthropic";
  }

  if (providerName === "ollama") {
    return "Ollama";
  }

  return "Heuristic";
}
