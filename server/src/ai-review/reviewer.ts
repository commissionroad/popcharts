import { logVerdictRun } from "src/shared/verdict-run-log";

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
 * Runs the full market review pipeline. The deterministic heuristic pass runs
 * first and its reject is final — no model output can overturn a hard flag.
 * Provider errors either surface as retryable failures for the durable runner
 * or degrade to the heuristic finding with an approve downgraded to
 * manual_review, depending on runtime configuration.
 */
export async function reviewMarket({
  config,
  request,
}: {
  config: AiReviewConfig;
  request: MarketReviewRequest;
}): Promise<ReviewResult> {
  const startedAtMs = performance.now();
  const requestedModel = request.options?.model ?? undefined;
  const heuristic = runHeuristicPolicy(request.metadata);

  if (heuristic.verdict === "reject") {
    const rejected = mergeReviewFindings({
      evidence: [],
      heuristic,
      promptVersion: AI_REVIEW_PROMPT_VERSION,
    });

    // A hard-flag reject never reaches a model, but it is still a run the
    // service performed and still the denominator of any per-provider rate —
    // omitting it would make heuristic rejects invisible in an aggregate.
    logRun({
      model: undefined,
      ok: true,
      outcome: rejected.verdict,
      provider: "heuristic",
      startedAtMs,
    });

    return rejected;
  }

  const providerName = request.options?.provider ?? config.provider;
  const provider = getReviewProvider(providerName);

  let evidence: ReviewResult["evidence"] = [];

  // A provider that cannot browse always needs evidence gathered for it. A
  // provider that can browse needs it too when the service is configured to
  // gather evidence itself rather than let each model use its own tools.
  if (
    provider.capabilities.requiresPreCollectedEvidence ||
    config.evidenceMode === "precollected"
  ) {
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

    const reviewed = buildReviewResult({
      heuristic,
      providerName,
      providerReview,
    });

    logRun({
      model: providerReview.modelId ?? requestedModel,
      ok: true,
      outcome: reviewed.verdict,
      provider: providerName,
      startedAtMs,
      usage: providerReview.usage,
    });

    return reviewed;
  } catch (error) {
    // Both exits are the same fact for telemetry — the provider did not answer
    // — so the line is emitted once, before they diverge.
    logRun({
      model: requestedModel,
      ok: false,
      outcome: config.retryProviderFailures ? "retry" : "manual_review",
      provider: providerName,
      startedAtMs,
    });

    if (config.retryProviderFailures) {
      throw new ReviewUnavailableError(providerName, error);
    }

    return modelUnavailableReview({
      allowHeuristicApprove: config.fallbackApprove,
      error,
      evidence,
      heuristic,
      providerName,
    });
  }
}

/**
 * Emits the per-run telemetry line for this service, binding the two constants
 * every review run shares so no call site can get them wrong.
 */
function logRun({
  model,
  ok,
  outcome,
  provider,
  startedAtMs,
  usage,
}: Omit<
  Parameters<typeof logVerdictRun>[0],
  "latencyMs" | "promptVersion" | "service"
> & { startedAtMs: number }) {
  logVerdictRun({
    latencyMs: performance.now() - startedAtMs,
    model,
    ok,
    outcome,
    promptVersion: AI_REVIEW_PROMPT_VERSION,
    provider,
    service: "review",
    usage,
  });
}

/** Signals a transient provider failure that the durable runner should retry. */
export class ReviewUnavailableError extends Error {
  constructor(
    readonly providerName: ReviewProviderName,
    cause: unknown,
  ) {
    super(
      cause instanceof Error
        ? `${displayProviderName(providerName)} review unavailable: ${cause.message}`
        : `${displayProviderName(providerName)} review unavailable.`,
      { cause },
    );
    this.name = "ReviewUnavailableError";
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
  allowHeuristicApprove = false,
  error,
  evidence = [],
  heuristic,
  providerName,
}: {
  allowHeuristicApprove?: boolean;
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
    scoreRationales: {
      ...heuristic.scoreRationales,
      disputeRisk:
        "Dispute risk was raised because the configured model reviewer was unavailable.",
    },
    scores: {
      ...heuristic.scores,
      disputeRisk: Math.max(heuristic.scores.disputeRisk, 4),
    },
    sourceChecks: heuristic.sourceChecks,
    // A hard-flag reject is always final. Otherwise the model outage normally
    // downgrades the heuristic's `approve` to `manual_review` so a provider
    // outage never auto-approves without a model.
    verdict:
      allowHeuristicApprove || heuristic.verdict !== "approve"
        ? heuristic.verdict
        : "manual_review",
  };
}

/**
 * Operator-facing name for the provider that failed, used in the stored
 * "review unavailable" reason. A total record rather than a fallback chain:
 * the previous chain returned "Heuristic" for every unlisted provider, so a
 * claude-cli outage was recorded as a heuristic failure and hid which backend
 * actually broke. The satisfies clause makes a new provider a compile error.
 */
const PROVIDER_DISPLAY_NAMES = {
  anthropic: "Anthropic",
  "claude-cli": "Claude CLI",
  "codex-cli": "Codex CLI",
  heuristic: "Heuristic",
  ollama: "Ollama",
  openai: "OpenAI",
} satisfies Record<ReviewProviderName, string>;

function displayProviderName(providerName: ReviewProviderName) {
  return PROVIDER_DISPLAY_NAMES[providerName];
}
