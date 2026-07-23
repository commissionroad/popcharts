import type {
  ConfigValidationResult,
  EvidenceItem,
  InternetAccessMode,
  SourceCheck,
} from "src/ai-review/types";

export type { ConfigValidationResult, InternetAccessMode };

/**
 * Contract types for AI-assisted resolution (ADR 0012). Built as a sibling of
 * AI review — the evidence and source-check shapes are reused verbatim from
 * `src/ai-review/types`; only the verdict semantics differ.
 */

/** Model providers the resolution service can call. Mirrors the review
 * backends by design (sibling architecture) but is a separate registry, so
 * the sets may drift deliberately. */
export const RESOLUTION_MODEL_PROVIDER_NAMES = [
  "anthropic",
  "heuristic",
  "ollama",
] as const;

/** One of {@link RESOLUTION_MODEL_PROVIDER_NAMES}. */
export type ResolutionModelProviderName =
  (typeof RESOLUTION_MODEL_PROVIDER_NAMES)[number];

/**
 * Who produced a resolution row. The model providers plus `manual` for
 * operator override / trusted-creator self-resolve, which are audited with
 * the same table but never come from a model — `manual` is a valid audit-row
 * provider but never a service selection.
 */
export const RESOLUTION_PROVIDER_NAMES = [
  ...RESOLUTION_MODEL_PROVIDER_NAMES,
  "manual",
] as const;

/** One of {@link RESOLUTION_PROVIDER_NAMES}. */
export type ResolutionProviderName = (typeof RESOLUTION_PROVIDER_NAMES)[number];

/**
 * The model/heuristic determination of a market's outcome.
 * - `yes` / `no`: a decided binary outcome.
 * - `draw`: neither side won (redeem at half); always parks for an operator.
 * - `too_early`: the event has not concluded; re-queue with backoff.
 * - `abstain`: cannot determine from available evidence; park for a human.
 */
export type ResolutionOutcome = "yes" | "no" | "draw" | "too_early" | "abstain";

/**
 * The action derived from an outcome plus the confidence/evidence/time gates.
 * - `resolve_yes` / `resolve_no`: submit `resolve(side)` on-chain.
 * - `cancel_draw`: recommend `cancel()` — parked for operator confirmation,
 *   never auto-submitted.
 * - `requeue_too_early`: bump `run_after` and try again later.
 * - `manual_review`: park for an operator (low confidence, abstain, error).
 */
export type ResolutionVerdict =
  | "resolve_yes"
  | "resolve_no"
  | "cancel_draw"
  | "requeue_too_early"
  | "manual_review";

/**
 * The submitter-authored market text plus the resolution timing the market
 * committed to on-chain. Every string field is untrusted user input and must be
 * treated as potential prompt injection; the timestamps are trusted (they come
 * from chain state, not the prompt) and let the model reason about `too_early`.
 */
export type MarketResolutionMetadata = {
  category?: string;
  description?: string;
  metadataHash?: string;
  /** ISO 8601. The market's on-chain observation window, if set (guidance). */
  observationWindowEnd?: string;
  observationWindowStart?: string;
  question: string;
  resolutionCriteria: string;
  resolutionSources?: string[];
  resolutionUrl?: string;
};

/** On-chain identifiers included in the prompt for traceability only. */
export type MarketResolutionContext = {
  chainId?: number;
  creator?: string;
  marketId?: string;
  postgradMarketAddress?: string;
};

/**
 * Per-request overrides of the service defaults, set by the operator or job
 * queue (never derived from market text): provider, model, evidence budgets.
 */
export type MarketResolutionOptions = {
  fetchSearchResults?: boolean;
  internetAccess?: InternetAccessMode;
  maxSearchResults?: number;
  model?: string;
  provider?: ResolutionModelProviderName;
};

/** One complete, stateless resolution request as accepted by the service. */
export type MarketResolutionRequest = {
  context?: MarketResolutionContext;
  metadata: MarketResolutionMetadata;
  options?: MarketResolutionOptions;
};

/**
 * Static traits of a provider the pipeline uses to decide what work to do
 * before calling it — notably whether evidence must be pre-collected because
 * the provider cannot browse on its own.
 */
export type ResolutionProviderCapabilities = {
  canRunOffline: boolean;
  requiresApiKey: boolean;
  requiresLocalRuntime: boolean;
  requiresPreCollectedEvidence: boolean;
  supportsNativeWebSearch: boolean;
};

/**
 * A single provider's raw judgment (heuristic pass or one model call) before it
 * is turned into a verdict by the abstention/time gates. `confidence` is null
 * only for the heuristic pre-pass, which never decides on its own.
 */
export type ResolutionFinding = {
  confidence: number | null;
  hardFlags: string[];
  outcome: ResolutionOutcome;
  reasons: string[];
  sourceChecks: SourceCheck[];
};

/**
 * What a provider hands back to the pipeline: its finding plus the evidence it
 * used (native tool results, or the pre-collected set passed in) and the model
 * that produced it.
 */
export type ResolutionFindingWithEvidence = ResolutionFinding & {
  evidence: EvidenceItem[];
  modelId?: string;
};

/**
 * A completed resolution determination the service returns and the runner
 * persists: outcome, derived verdict, evidence trail, and the
 * provider/model/prompt version that produced it.
 */
export interface ResolutionResult {
  outcome: ResolutionOutcome;
  verdict: ResolutionVerdict;
  /** 0..1; null for `manual` provider rows where confidence is not applicable. */
  confidence: number | null;
  evidence: EvidenceItem[];
  hardFlags: string[];
  modelId?: string;
  promptVersion: string;
  provider: ResolutionProviderName;
  reasons: string[];
  sourceChecks: SourceCheck[];
}
