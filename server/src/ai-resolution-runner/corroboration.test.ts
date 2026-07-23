import { describe, expect, it } from "bun:test";

import type {
  ResolutionResult,
  ResolutionVerdict,
} from "src/ai-resolution/types";
import {
  corroborateResolution,
  isSubmittableResolutionVerdict,
} from "./corroboration";

function resolutionResult(
  verdict: ResolutionVerdict,
  overrides: Partial<ResolutionResult> = {},
): ResolutionResult {
  return {
    confidence: 0.9,
    evidence: [],
    hardFlags: [],
    outcome:
      verdict === "resolve_yes"
        ? "yes"
        : verdict === "resolve_no"
          ? "no"
          : "abstain",
    promptVersion: "market-ai-resolution-v1",
    provider: "heuristic",
    reasons: [`${verdict} because of test fixtures`],
    sourceChecks: [],
    verdict,
    ...overrides,
  };
}

function scriptedService(results: ResolutionResult[]) {
  let calls = 0;
  return {
    callService: async () => {
      const result = results[calls];
      calls += 1;
      if (!result) {
        throw new Error(`Unexpected corroboration call #${calls}.`);
      }
      return result;
    },
    calls: () => calls,
  };
}

describe("isSubmittableResolutionVerdict", () => {
  it("marks only resolve_yes and resolve_no submittable", () => {
    expect(isSubmittableResolutionVerdict("resolve_yes")).toBe(true);
    expect(isSubmittableResolutionVerdict("resolve_no")).toBe(true);
    expect(isSubmittableResolutionVerdict("cancel_draw")).toBe(false);
    expect(isSubmittableResolutionVerdict("manual_review")).toBe(false);
    expect(isSubmittableResolutionVerdict("requeue_too_early")).toBe(false);
  });
});

describe("corroborateResolution", () => {
  it("confirms a YES with one agreeing second run", async () => {
    const first = resolutionResult("resolve_yes");
    const second = resolutionResult("resolve_yes", {
      reasons: ["second opinion"],
    });
    const service = scriptedService([second]);
    const corroborated = await corroborateResolution({
      ...service,
      first,
    });

    expect(corroborated.outcome).toBe("confirmed");
    expect(corroborated.result).toBe(second);
    expect(corroborated.runs).toEqual([first, second]);
    expect(service.calls()).toBe(1);
  });

  it("confirms a 2-of-3 majority through the tiebreak", async () => {
    const first = resolutionResult("resolve_no");
    const tiebreak = resolutionResult("resolve_no", { reasons: ["tiebreak"] });
    const service = scriptedService([
      resolutionResult("manual_review"),
      tiebreak,
    ]);
    const corroborated = await corroborateResolution({
      ...service,
      first,
    });

    expect(corroborated.outcome).toBe("tiebreak_confirmed");
    expect(corroborated.result).toBe(tiebreak);
    expect(service.calls()).toBe(2);
  });

  it("lets the tiebreak flip YES to NO for the caller to re-gate", async () => {
    const first = resolutionResult("resolve_yes");
    const service = scriptedService([
      resolutionResult("resolve_no"),
      resolutionResult("resolve_no", { reasons: ["flip"] }),
    ]);
    const corroborated = await corroborateResolution({
      ...service,
      first,
    });

    expect(corroborated.outcome).toBe("tiebreak_confirmed");
    expect(corroborated.result.verdict).toBe("resolve_no");
  });

  it("demotes to manual_review when no submittable majority forms", async () => {
    const first = resolutionResult("resolve_yes", {
      reasons: ["original yes"],
    });
    const service = scriptedService([
      resolutionResult("cancel_draw"),
      resolutionResult("manual_review"),
    ]);
    const corroborated = await corroborateResolution({
      ...service,
      first,
    });

    expect(corroborated.outcome).toBe("demoted");
    expect(corroborated.result.verdict).toBe("manual_review");
    expect(corroborated.result.reasons[0]).toContain("runs disagreed");
    expect(corroborated.result.reasons[0]).toContain(
      "resolve_yes, cancel_draw, manual_review",
    );
    expect(corroborated.result.reasons).toContain("original yes");
    // The model's own outcome is preserved; only the pipeline verdict parks.
    expect(corroborated.result.outcome).toBe("yes");
  });

  it("renews the lease before each extra run", async () => {
    const renewedBefore: number[] = [];
    const service = scriptedService([
      resolutionResult("manual_review"),
      resolutionResult("resolve_yes"),
    ]);
    await corroborateResolution({
      ...service,
      first: resolutionResult("resolve_yes"),
      onBeforeRun: async (run) => {
        renewedBefore.push(run);
      },
    });

    expect(renewedBefore).toEqual([2, 3]);
  });

  it("propagates service errors so job retry semantics stay intact", async () => {
    const failing = {
      callService: async () => {
        throw new Error("service unreachable");
      },
      first: resolutionResult("resolve_yes"),
    };

    await expect(corroborateResolution(failing)).rejects.toThrow(
      "service unreachable",
    );
  });
});
