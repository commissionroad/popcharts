import {
  AUTO_RESOLVE_VERDICT_BY_SIDE,
  type ResolutionOutcome,
  type ResolutionResult,
  type ResolutionVerdict,
} from "./types";

/**
 * The confidence floor a decided YES/NO must clear to auto-resolve (ADR 0012).
 * Lives here rather than in either config so the service and the runner cannot
 * fall back to different numbers when the env var is absent.
 */
export const DEFAULT_ABSTENTION_THRESHOLD = 0.85;

/**
 * A submitting verdict that fails the auto-resolve invariant. Thrown by
 * {@link assertAutoResolvable} at the signer boundary, where the only correct
 * response is to stop — never to park a judgment row, because an unsafe
 * response is a broken or hostile service, not a model's opinion about the
 * market.
 */
export class UnsafeAutoResolveError extends Error {
  constructor(readonly blockers: readonly string[]) {
    super(`Refusing to submit an on-chain resolution: ${blockers.join("; ")}.`);
    this.name = "UnsafeAutoResolveError";
  }
}

/**
 * The single definition of what disqualifies a decided outcome from
 * auto-resolving: confidence at or above the threshold, at least one evidence
 * item, and zero hard flags. Returns one human-readable reason per failed
 * condition, or an empty array when the outcome may auto-resolve.
 *
 * Both sides of the HTTP boundary call this — `deriveVerdict` to choose a
 * verdict, and the runner to re-check the verdict it was handed. Keeping it in
 * one function is what makes the second check defense in depth rather than a
 * copy of the rule that can drift from the original.
 */
export function autoResolveBlockers({
  abstentionThreshold,
  confidence,
  evidenceCount,
  hardFlags,
}: {
  abstentionThreshold: number;
  confidence: number | null;
  evidenceCount: number;
  hardFlags: readonly string[];
}): string[] {
  const blockers: string[] = [];

  if (typeof confidence !== "number" || Number.isNaN(confidence)) {
    blockers.push("confidence is missing");
  } else if (confidence < abstentionThreshold) {
    blockers.push(
      `confidence ${confidence} is below the ${abstentionThreshold} threshold`,
    );
  }

  if (evidenceCount < 1) {
    blockers.push("no evidence items");
  }

  if (hardFlags.length > 0) {
    blockers.push(`hard flags present (${hardFlags.join(", ")})`);
  }

  return blockers;
}

/** True for the verdicts that submit an irreversible on-chain resolution. */
export function isAutoResolveVerdict(verdict: ResolutionVerdict): boolean {
  return Object.values(AUTO_RESOLVE_VERDICT_BY_SIDE).some(
    (submitting) => submitting === verdict,
  );
}

/**
 * The check the key-holding caller runs immediately before it signs. Throws
 * {@link UnsafeAutoResolveError} when a submitting verdict fails the
 * auto-resolve invariant, or when the verdict does not match the outcome it
 * claims to derive from.
 *
 * The outcome/verdict coherence check exists only here. The service *derives*
 * the verdict from the outcome, so it cannot disagree with itself; a response
 * that crossed a process boundary can, and a `resolve_yes` carrying
 * `outcome: "no"` would otherwise submit the losing side.
 *
 * A non-submitting verdict passes untouched — parks, draws, and re-queues move
 * no money and are not this function's business.
 */
export function assertAutoResolvable(
  result: Pick<
    ResolutionResult,
    "confidence" | "evidence" | "hardFlags" | "outcome" | "verdict"
  >,
  abstentionThreshold: number,
): void {
  if (!isAutoResolveVerdict(result.verdict)) {
    return;
  }

  const blockers = autoResolveBlockers({
    abstentionThreshold,
    confidence: result.confidence,
    evidenceCount: result.evidence.length,
    hardFlags: result.hardFlags,
  });

  const expected = expectedVerdictForOutcome(result.outcome);
  if (expected !== result.verdict) {
    blockers.push(
      `verdict ${result.verdict} does not match outcome ${result.outcome}`,
    );
  }

  if (blockers.length > 0) {
    throw new UnsafeAutoResolveError(blockers);
  }
}

/** The submitting verdict an outcome maps to, or null when it never submits. */
function expectedVerdictForOutcome(
  outcome: ResolutionOutcome,
): ResolutionVerdict | null {
  if (outcome === "yes" || outcome === "no") {
    return AUTO_RESOLVE_VERDICT_BY_SIDE[outcome];
  }

  return null;
}
