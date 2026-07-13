import { describe, expect, it } from "bun:test";

import {
  parseConfidence,
  parseModelResolution,
  parseOutcome,
} from "./resolution-parsing";

describe("parseModelResolution", () => {
  it("parses a clean JSON reply", () => {
    expect(parseModelResolution('{"outcome":"yes"}', "Test")).toEqual({
      outcome: "yes",
    });
  });

  it("recovers JSON embedded in prose or markdown", () => {
    const content = 'Here is my answer:\n```json\n{"outcome":"no"}\n```';
    expect(parseModelResolution(content, "Test")).toEqual({ outcome: "no" });
  });

  it("throws a labelled error when there is no JSON", () => {
    expect(() => parseModelResolution("no json here", "Ollama")).toThrow(
      "Ollama did not return JSON.",
    );
  });
});

describe("parseOutcome", () => {
  it("accepts every known outcome", () => {
    for (const outcome of [
      "yes",
      "no",
      "draw",
      "too_early",
      "abstain",
    ] as const) {
      expect(parseOutcome(outcome)).toBe(outcome);
    }
  });

  it("falls back to abstain for anything unrecognized", () => {
    expect(parseOutcome("approve")).toBe("abstain");
    expect(parseOutcome(undefined)).toBe("abstain");
    expect(parseOutcome(1)).toBe("abstain");
  });
});

describe("parseConfidence", () => {
  it("passes through a value in range", () => {
    expect(parseConfidence(0.85)).toBe(0.85);
  });

  it("clamps values outside [0,1]", () => {
    expect(parseConfidence(1.5)).toBe(1);
    expect(parseConfidence(-2)).toBe(0);
  });

  it("returns null for non-finite or non-numbers", () => {
    expect(parseConfidence(Number.NaN)).toBeNull();
    expect(parseConfidence("0.9")).toBeNull();
    expect(parseConfidence(undefined)).toBeNull();
  });
});
