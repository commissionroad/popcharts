import { unique } from "src/ai-review/response-parsing";
import { logVerdictRun } from "src/shared/verdict-run-log";

import { autoResolveBlockers } from "./auto-resolvable";
import {
  AI_RESOLUTION_PROMPT_VERSION,
  type AiResolutionConfig,
} from "./config";
import { collectEvidence } from "./evidence";
import { runHeuristicResolution } from "./heuristics";
import { getResolutionProvider } from "./providers/registry";
import { filterSourceChecksByEvidence } from "./resolution-parsing";
import {
  AUTO_RESOLVE_VERDICT_BY_SIDE,
  type MarketResolutionRequest,
  type ResolutionFindingWithEvidence,
  type ResolutionModelProviderName,
  type ResolutionOutcome,
  type ResolutionResult,
  type ResolutionVerdict,
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
  const requestedModel = request.options?.model ?? undefined;
  const startedAtMs = performance.now();
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
    // A failed provider call is still a run: it consumed wall clock and it is
    // the denominator of any error rate, so it gets a telemetry line too — with
    // ok:false so an aggregate can separate outages from judgments.
    logVerdictRun({
      latencyMs: performance.now() - startedAtMs,
      model: requestedModel,
      ok: false,
      outcome: "manual_review",
      promptVersion: AI_RESOLUTION_PROMPT_VERSION,
      provider: providerName,
      service: "resolution",
    });

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

  const result = buildResult(finding, providerName, config.abstentionThreshold);

  logVerdictRun({
    latencyMs: performance.now() - startedAtMs,
    model: finding.modelId ?? requestedModel,
    ok: true,
    outcome: result.verdict,
    promptVersion: AI_RESOLUTION_PROMPT_VERSION,
    provider: providerName,
    service: "resolution",
    usage: finding.usage,
  });

  return result;
}

/**
 * The safety gate. A decided YES/NO auto-resolves only with confidence at or
 * above the abstention threshold AND at least one evidence item AND zero hard
 * flags — any model-emitted flag (e.g. prompt_injection, sources_disagree)
 * parks the market instead of resolving it; a draw always parks for an
 * operator (`cancel_draw`); `too_early` re-queues; everything else (abstain,
 * low confidence, no evidence) parks as `manual_review`.
 */
export function deriveVerdict(
  outcome: ResolutionOutcome,
  confidence: number | null,
  evidenceCount: number,
  abstentionThreshold: number,
  hardFlags: readonly string[],
): ResolutionVerdict {
  if (outcome === "too_early") {
    return "requeue_too_early";
  }

  if (outcome === "draw") {
    return "cancel_draw";
  }

  if (outcome === "yes" || outcome === "no") {
    // One definition of the rule, shared with the runner's pre-signing check
    // (see auto-resolvable.ts). Deriving and re-checking from the same function
    // is what stops the two sides of the HTTP boundary from drifting apart.
    const blockers = autoResolveBlockers({
      abstentionThreshold,
      confidence,
      evidenceCount,
      hardFlags,
    });
    if (blockers.length === 0) {
      return AUTO_RESOLVE_VERDICT_BY_SIDE[outcome];
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
  const hardFlags = unique(finding.hardFlags);
  const verdict = deriveVerdict(
    finding.outcome,
    finding.confidence,
    finding.evidence.length,
    abstentionThreshold,
    hardFlags,
  );
  // Record why a flagged decided outcome parked; verdict and reason derive
  // from the same deduped array, so they cannot disagree.
  const flagsParkedDecidedOutcome =
    (finding.outcome === "yes" || finding.outcome === "no") &&
    hardFlags.length > 0 &&
    verdict === "manual_review";
  const reasons = flagsParkedDecidedOutcome
    ? [
        ...finding.reasons,
        `Hard flags (${hardFlags.join(", ")}) block auto-resolve; parked for manual review.`,
      ]
    : finding.reasons;

  return {
    confidence: finding.confidence,
    evidence: finding.evidence,
    hardFlags,
    modelId: finding.modelId,
    outcome: finding.outcome,
    promptVersion: AI_RESOLUTION_PROMPT_VERSION,
    provider,
    reasons,
    sourceChecks: filterSourceChecksByEvidence(
      finding.sourceChecks,
      finding.evidence,
    ),
    verdict,
  };
}

function failSafeReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Resolution service error; parked for manual review: ${message.slice(0, 300)}`;
}
