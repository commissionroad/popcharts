import { describe, expect, it } from "bun:test";

import {
  parseResolutionResult,
  ResolutionResultSchemaError,
} from "./result-schema";
import type { ResolutionResult } from "./types";

/** A complete, valid result — every optional field populated. */
const complete: ResolutionResult = {
  confidence: 0.93,
  evidence: [
    {
      domain: "example.org",
      kind: "search_result",
      sourceTier: "primary",
      summary: "Official result page.",
      title: "Result",
      url: "https://example.org/result",
    },
  ],
  hardFlags: [],
  modelId: "test-model",
  outcome: "yes",
  promptVersion: "v1",
  provider: "ollama",
  reasons: ["The primary source states YES."],
  sourceChecks: [],
  verdict: "resolve_yes",
};

describe("parseResolutionResult", () => {
  // Drift guard: if ResolutionResult gains a required field that the schema
  // does not describe, this fails rather than letting the schema silently
  // stop validating that field.
  it("accepts a complete ResolutionResult", () => {
    expect(parseResolutionResult(structuredClone(complete))).toEqual(complete);
  });

  it("accepts a result without the optional modelId", () => {
    const { modelId: _omitted, ...withoutModel } = complete;

    expect(parseResolutionResult(withoutModel)).toEqual(withoutModel);
  });

  it("accepts a null confidence on a parked result", () => {
    const parked: ResolutionResult = {
      ...complete,
      confidence: null,
      verdict: "manual_review",
    };

    expect(parseResolutionResult(parked)).toEqual(parked);
  });

  it("rejects a missing verdict", () => {
    const { verdict: _dropped, ...withoutVerdict } = complete;

    expect(() => parseResolutionResult(withoutVerdict)).toThrow(
      ResolutionResultSchemaError,
    );
  });

  it("rejects a verdict outside the known set", () => {
    expect(() =>
      parseResolutionResult({ ...complete, verdict: "resolve_maybe" }),
    ).toThrow(ResolutionResultSchemaError);
  });

  it("rejects a confidence that is not a number", () => {
    expect(() =>
      parseResolutionResult({ ...complete, confidence: "0.93" }),
    ).toThrow(ResolutionResultSchemaError);
  });

  it("rejects evidence that is not an array", () => {
    expect(() =>
      parseResolutionResult({ ...complete, evidence: "none" }),
    ).toThrow(ResolutionResultSchemaError);
  });

  it("rejects a bare string body", () => {
    expect(() => parseResolutionResult("not json at all")).toThrow(
      ResolutionResultSchemaError,
    );
  });

  it("rejects null", () => {
    expect(() => parseResolutionResult(null)).toThrow(
      ResolutionResultSchemaError,
    );
  });

  it("names the offending fields in the message", () => {
    try {
      parseResolutionResult({ ...complete, verdict: 42 });
      throw new Error("expected parseResolutionResult to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ResolutionResultSchemaError);
      expect((error as ResolutionResultSchemaError).message).toContain(
        "/verdict",
      );
    }
  });
});
