import { describe, expect, it } from "bun:test";

import { clampScore, DEFAULT_SCORES, normalizeScores } from "./scoring";
import { sourceTierForDomain } from "./scoring";

describe("clampScore", () => {
  it("accepts a score the model emitted as a numeric string", () => {
    // Some models return scores as JSON strings. Rejecting them is silent —
    // the score becomes the conservative fallback with no error raised.
    expect(clampScore("5", 0)).toBe(5);
    expect(clampScore(" 4 ", 0)).toBe(4);
  });

  it("still falls back for values that are not numbers", () => {
    expect(clampScore("", 3)).toBe(3);
    expect(clampScore("high", 3)).toBe(3);
    expect(clampScore(null, 3)).toBe(3);
    expect(clampScore(Number.NaN, 3)).toBe(3);
  });

  it("clamps out-of-range values from either representation", () => {
    expect(clampScore("9", 0)).toBe(5);
    expect(clampScore(-2, 0)).toBe(0);
  });
});

describe("normalizeScores", () => {
  it("does not silently degrade a fully string-valued score object", () => {
    const scores = normalizeScores({
      contentSafety: "5",
      corroboration: "4",
      disputeRisk: "1",
      objectivity: "5",
      promptInjectionRisk: "0",
      publicKnowability: "5",
      sourceQuality: "5",
    });

    expect(scores.sourceQuality).toBe(5);
    expect(scores.corroboration).toBe(4);
    expect(scores.corroboration).not.toBe(DEFAULT_SCORES.corroboration);
  });
});

describe("sourceTierForDomain", () => {
  it("classifies user-generated and satirical domains as low-trust sources", () => {
    expect(sourceTierForDomain("facebook.com")).toBe("ugc");
    expect(sourceTierForDomain("www.facebook.com")).toBe("ugc");
    expect(sourceTierForDomain("theonion.com")).toBe("suspicious");
    expect(sourceTierForDomain("www.theonion.com")).toBe("suspicious");
  });
});
