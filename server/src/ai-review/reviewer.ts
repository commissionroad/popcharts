import { reviewWithAnthropic } from "./anthropic";
import { AI_REVIEW_PROMPT_VERSION, type AiReviewConfig } from "./config";
import { collectEvidence } from "./evidence";
import { runHeuristicPolicy } from "./heuristics";
import { mergeReviewFindings, reviewWithOllama } from "./ollama";
import type { MarketReviewRequest, ReviewResult } from "./types";

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

  const provider = request.options?.provider ?? config.provider;

  if (provider === "anthropic") {
    try {
      const model = await reviewWithAnthropic({
        config,
        model: request.options?.model,
        request,
      });

      return mergeReviewFindings({
        evidence: model.evidence,
        heuristic,
        model,
        modelId: model.modelId,
        modelProvider: "anthropic",
        promptVersion: AI_REVIEW_PROMPT_VERSION,
      });
    } catch (error) {
      return modelUnavailableReview({
        error,
        heuristic,
        providerName: "Anthropic",
      });
    }
  }

  const evidence = await collectEvidence({ config, request });

  if (provider === "heuristic") {
    return mergeReviewFindings({
      evidence,
      heuristic,
      promptVersion: AI_REVIEW_PROMPT_VERSION,
    });
  }

  try {
    const model = await reviewWithOllama({
      config,
      evidence,
      model: request.options?.model,
      request,
    });

    return mergeReviewFindings({
      evidence,
      heuristic,
      model,
      modelId: model.modelId,
      modelProvider: "ollama",
      promptVersion: AI_REVIEW_PROMPT_VERSION,
    });
  } catch (error) {
    return modelUnavailableReview({
      error,
      evidence,
      heuristic,
      providerName: "Ollama",
    });
  }
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
  providerName: string;
}): ReviewResult {
  return {
    evidence,
    hardFlags: heuristic.hardFlags,
    promptVersion: AI_REVIEW_PROMPT_VERSION,
    provider: "heuristic",
    reasons: [
      ...heuristic.reasons,
      error instanceof Error
        ? `${providerName} review unavailable: ${error.message}`
        : `${providerName} review unavailable.`,
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
