import { describe, expect, it } from "bun:test";

import { runHeuristicResolution } from "./heuristics";

function metadata(resolutionCriteria: string) {
  return { question: "Did it happen?", resolutionCriteria };
}

describe("runHeuristicResolution", () => {
  it("reads a decided YES/NO marker with full confidence", () => {
    expect(
      runHeuristicResolution(metadata("[heuristic-outcome: yes]")),
    ).toEqual({
      confidence: 1,
      hardFlags: [],
      outcome: "yes",
      reasons: ['Heuristic outcome marker resolved to "yes".'],
      sourceChecks: [],
    });

    const no = runHeuristicResolution(metadata("[heuristic-outcome: NO]"));
    expect(no.outcome).toBe("no");
    expect(no.confidence).toBe(1);
  });

  it("treats draw and too_early as non-decided (null confidence)", () => {
    expect(
      runHeuristicResolution(metadata("[heuristic-outcome: draw]")).confidence,
    ).toBeNull();
    expect(
      runHeuristicResolution(metadata("[heuristic-outcome: too_early]"))
        .outcome,
    ).toBe("too_early");
  });

  it("abstains when no marker is present", () => {
    const result = runHeuristicResolution(metadata("Resolve from the news."));
    expect(result.outcome).toBe("abstain");
    expect(result.confidence).toBeNull();
    expect(result.reasons[0]).toContain("No heuristic outcome marker");
  });
});
