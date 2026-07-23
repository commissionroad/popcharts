import { unique } from "src/ai-review/response-parsing";

import {
  AI_RESOLUTION_PROMPT_VERSION,
  type AiResolutionConfig,
} from "./config";
import { collectEvidence } from "./evidence";
import { runHeuristicResolution } from "./heuristics";
import { getResolutionProvider } from "./providers/registry";
import { filterSourceChecksByEvidence } from "./resolution-parsing";
import type {
  MarketResolutionRequest,
  ResolutionFindingWithEvidence,
  ResolutionModelProviderName,
  ResolutionOutcome,
  ResolutionResult,
  ResolutionVerdict,
} from "./types";

export type ResolveMarketInput = {
  config: AiResolutionConfig;
  nowMs: number;
  request: MarketResolutionRequest;
};

/**
 * Hard flag stamped on the fail-safe result when the provider call itself
 * failed (outage, timeout, config error). Consumers that must distinguish "the
 * model judged abstain" from "the model never answered" — notably the eval
 * runner — key off this flag; import it rather than mirroring the literal.
 */
export const SERVICE_ERROR_HARD_FLAG = "service_error";

/**
 * Runs one stateless resolution: heuristic pre-pass, provider call, then the
 * verdict-derivation gates. Any provider/config error fail-safes to
 * `manual_review` — an outage never resolves a market.
 */
export async function resolveMarket({
  config,
  nowMs,
  request,
}: ResolveMarketInput): Promise<ResolutionResult> {
  const providerName: ResolutionModelProviderName =
    request.options?.provider ?? config.provider;
  const heuristic = runHeuristicResolution(request.metadata);

  let finding: ResolutionFindingWithEvidence;
  try {
    const provider = getResolutionProvider(providerName);
    // Providers that cannot browse (Ollama) get evidence pre-collected through
    // the SSRF-guarded safe-web path; browsing providers collect their own.
    const evidence = provider.capabilities.requiresPreCollectedEvidence
      ? await collectEvidence({ config, request })
      : [];
    finding = await provider.resolve({
      config,
      evidence,
      heuristic,
      model: request.options?.model,
      nowMs,
      request,
    });
  } catch (error) {
    return {
      confidence: null,
      evidence: [],
      hardFlags: [SERVICE_ERROR_HARD_FLAG],
      modelId: undefined,
      outcome: "abstain",
      promptVersion: AI_RESOLUTION_PROMPT_VERSION,
      provider: providerName,
      reasons: [failSafeReason(error)],
      sourceChecks: [],
      verdict: "manual_review",
    };
  }

  return buildResult(finding, providerName, config.abstentionThreshold);
}

/**
 * The safety gate. A decided YES/NO auto-resolves only with confidence at or
 * above the abstention threshold AND at least one evidence item; a draw always
 * parks for an operator (`cancel_draw`); `too_early` re-queues; everything else
 * (abstain, low confidence, no evidence) parks as `manual_review`.
 */
export function deriveVerdict(
  outcome: ResolutionOutcome,
  confidence: number | null,
  evidenceCount: number,
  abstentionThreshold: number,
): ResolutionVerdict {
  if (outcome === "too_early") {
    return "requeue_too_early";
  }

  if (outcome === "draw") {
    return "cancel_draw";
  }

  if (outcome === "yes" || outcome === "no") {
    const confident =
      typeof confidence === "number" && confidence >= abstentionThreshold;
    if (confident && evidenceCount >= 1) {
      return outcome === "yes" ? "resolve_yes" : "resolve_no";
    }

    return "manual_review";
  }

  return "manual_review";
}

function buildResult(
  finding: ResolutionFindingWithEvidence,
  provider: ResolutionModelProviderName,
  abstentionThreshold: number,
): ResolutionResult {
  return {
    confidence: finding.confidence,
    evidence: finding.evidence,
    hardFlags: unique(finding.hardFlags),
    modelId: finding.modelId,
    outcome: finding.outcome,
    promptVersion: AI_RESOLUTION_PROMPT_VERSION,
    provider,
    reasons: finding.reasons,
    sourceChecks: filterSourceChecksByEvidence(
      finding.sourceChecks,
      finding.evidence,
    ),
    verdict: deriveVerdict(
      finding.outcome,
      finding.confidence,
      finding.evidence.length,
      abstentionThreshold,
    ),
  };
}

function failSafeReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Resolution service error; parked for manual review: ${message.slice(0, 300)}`;
}
