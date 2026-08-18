import { describe, expect, it } from "bun:test";

import {
  assertAutoResolvable,
  autoResolveBlockers,
  DEFAULT_ABSTENTION_THRESHOLD,
  isAutoResolveVerdict,
  UnsafeAutoResolveError,
} from "./auto-resolvable";
import type { EvidenceItem } from "src/ai-review/types";
import type { ResolutionResult } from "./types";

const evidence: EvidenceItem = {
  domain: "example.org",
  kind: "search_result",
  sourceTier: "primary",
  summary: "The event concluded with a YES outcome.",
  url: "https://example.org/result",
};

function resolvable(
  overrides: Partial<ResolutionResult> = {},
): ResolutionResult {
  return {
    confidence: 0.95,
    evidence: [evidence],
    hardFlags: [],
    outcome: "yes",
    promptVersion: "test",
    provider: "ollama",
    reasons: [],
    sourceChecks: [],
    verdict: "resolve_yes",
    ...overrides,
  };
}

describe("autoResolveBlockers", () => {
  const base = {
    abstentionThreshold: DEFAULT_ABSTENTION_THRESHOLD,
    confidence: 0.95,
    evidenceCount: 1,
    hardFlags: [] as string[],
  };

  it("returns no blockers when every condition passes", () => {
    expect(autoResolveBlockers(base)).toEqual([]);
  });

  it("blocks confidence below the threshold", () => {
    expect(autoResolveBlockers({ ...base, confidence: 0.84 })).toEqual([
      "confidence 0.84 is below the 0.85 threshold",
    ]);
  });

  it("admits confidence exactly at the threshold", () => {
    expect(autoResolveBlockers({ ...base, confidence: 0.85 })).toEqual([]);
  });

  it("blocks missing confidence", () => {
    expect(autoResolveBlockers({ ...base, confidence: null })).toEqual([
      "confidence is missing",
    ]);
  });

  it("blocks NaN confidence rather than comparing it", () => {
    expect(autoResolveBlockers({ ...base, confidence: Number.NaN })).toEqual([
      "confidence is missing",
    ]);
  });

  it("blocks an empty evidence set", () => {
    expect(autoResolveBlockers({ ...base, evidenceCount: 0 })).toEqual([
      "no evidence items",
    ]);
  });

  it("blocks any hard flag", () => {
    expect(
      autoResolveBlockers({ ...base, hardFlags: ["prompt_injection"] }),
    ).toEqual(["hard flags present (prompt_injection)"]);
  });

  it("reports every failed condition at once", () => {
    expect(
      autoResolveBlockers({
        abstentionThreshold: 0.85,
        confidence: 0.2,
        evidenceCount: 0,
        hardFlags: ["prompt_injection", "sources_disagree"],
      }),
    ).toHaveLength(3);
  });
});

describe("isAutoResolveVerdict", () => {
  it("is true only for the two submitting verdicts", () => {
    expect(isAutoResolveVerdict("resolve_yes")).toBe(true);
    expect(isAutoResolveVerdict("resolve_no")).toBe(true);
    expect(isAutoResolveVerdict("manual_review")).toBe(false);
    expect(isAutoResolveVerdict("cancel_draw")).toBe(false);
    expect(isAutoResolveVerdict("requeue_too_early")).toBe(false);
  });
});

describe("assertAutoResolvable", () => {
  it("accepts a fully compliant submitting result", () => {
    expect(() =>
      assertAutoResolvable(resolvable(), DEFAULT_ABSTENTION_THRESHOLD),
    ).not.toThrow();
  });

  it("rejects the payload the signer boundary exists to stop", () => {
    // Low confidence, zero evidence, and a blocking hard flag — the exact
    // shape a broken or hostile service could return with HTTP 200.
    expect(() =>
      assertAutoResolvable(
        resolvable({
          confidence: 0.2,
          evidence: [],
          hardFlags: ["prompt_injection"],
        }),
        DEFAULT_ABSTENTION_THRESHOLD,
      ),
    ).toThrow(UnsafeAutoResolveError);
  });

  it("rejects a submitting verdict that contradicts its own outcome", () => {
    expect(() =>
      assertAutoResolvable(
        resolvable({ outcome: "no", verdict: "resolve_yes" }),
        DEFAULT_ABSTENTION_THRESHOLD,
      ),
    ).toThrow(/does not match outcome/);
  });

  it("rejects a submitting verdict derived from a non-deciding outcome", () => {
    expect(() =>
      assertAutoResolvable(
        resolvable({ outcome: "abstain" }),
        DEFAULT_ABSTENTION_THRESHOLD,
      ),
    ).toThrow(/does not match outcome/);
  });

  it("enforces the caller's threshold, not the default", () => {
    const result = resolvable({ confidence: 0.9 });

    expect(() => assertAutoResolvable(result, 0.85)).not.toThrow();
    expect(() => assertAutoResolvable(result, 0.95)).toThrow(
      UnsafeAutoResolveError,
    );
  });

  it("names every blocker in the message", () => {
    try {
      assertAutoResolvable(
        resolvable({ confidence: 0.1, evidence: [], hardFlags: ["flagged"] }),
        DEFAULT_ABSTENTION_THRESHOLD,
      );
      throw new Error("expected assertAutoResolvable to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(UnsafeAutoResolveError);
      expect((error as UnsafeAutoResolveError).blockers).toHaveLength(3);
    }
  });

  it("ignores non-submitting verdicts entirely", () => {
    // A park carries no confidence and no evidence by design; the gate must
    // not turn safe states into errors.
    for (const verdict of [
      "manual_review",
      "cancel_draw",
      "requeue_too_early",
    ] as const) {
      expect(() =>
        assertAutoResolvable(
          resolvable({
            confidence: null,
            evidence: [],
            hardFlags: ["service_error"],
            outcome: "abstain",
            verdict,
          }),
          DEFAULT_ABSTENTION_THRESHOLD,
        ),
      ).not.toThrow();
    }
  });
});
