import type { EvidenceItem, SourceCheck } from "src/ai-review/types";

/**
 * Contract types for AI-assisted resolution (ADR 0012). Built as a sibling of
 * AI review — the evidence and source-check shapes are reused verbatim from
 * `src/ai-review/types`; only the verdict semantics differ.
 */

/**
 * Who produced a resolution row. Mirrors the review providers plus `manual`
 * for operator override / trusted-creator self-resolve, which are audited with
 * the same table but never come from a model.
 */
export type ResolutionProviderName =
  "anthropic" | "heuristic" | "ollama" | "manual";

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

/** A completed resolution determination, persisted append-only for audit. */
export interface ResolutionResult {
  outcome: ResolutionOutcome;
  verdict: ResolutionVerdict;
  /** 0..1; null for `manual` provider rows where confidence is not applicable. */
  confidence: number | null;
  reasons: string[];
  evidence: EvidenceItem[];
  sourceChecks: SourceCheck[];
  hardFlags: string[];
}
