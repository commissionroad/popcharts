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

  const evidence = await collectEvidence({ config, request });
  const provider = request.options?.provider ?? config.provider;

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
      promptVersion: AI_REVIEW_PROMPT_VERSION,
    });
  } catch (error) {
    return {
      evidence,
      hardFlags: heuristic.hardFlags,
      promptVersion: AI_REVIEW_PROMPT_VERSION,
      provider: "heuristic",
      reasons: [
        ...heuristic.reasons,
        error instanceof Error
          ? `Ollama review unavailable: ${error.message}`
          : "Ollama review unavailable.",
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
}
