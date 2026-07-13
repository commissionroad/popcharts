import { afterEach, describe, expect, it } from "bun:test";

import { resolveWithOllama } from "./ollama";
import type { MarketResolutionRequest } from "./types";

const config = {
  ollamaBaseUrl: "http://127.0.0.1:11434",
  ollamaModel: "test-model",
  requestTimeoutMs: 1_000,
};

const request: MarketResolutionRequest = {
  metadata: {
    question: "Did it happen?",
    resolutionCriteria: "Resolve from the official source.",
  },
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(body: unknown, ok = true) {
  globalThis.fetch = (() =>
    Promise.resolve({
      json: () => Promise.resolve(body),
      ok,
      status: ok ? 200 : 500,
    })) as unknown as typeof fetch;
}

describe("resolveWithOllama", () => {
  it("parses a decided outcome and drops sources with no backing evidence", async () => {
    mockFetch({
      message: {
        content: JSON.stringify({
          confidence: 0.9,
          hardFlags: [],
          outcome: "yes",
          reasons: ["Official source confirms it."],
          sourceChecks: [
            {
              domain: "example.com",
              notes: "",
              relevant: true,
              sourceTier: "primary",
              url: "https://example.com/a",
            },
          ],
        }),
      },
    });

    const finding = await resolveWithOllama({
      config,
      evidence: [],
      nowMs: 1_780_000_000_000,
      request,
    });

    expect(finding.outcome).toBe("yes");
    expect(finding.confidence).toBe(0.9);
    expect(finding.modelId).toBe("test-model");
    // No evidence was supplied, so the invented sourceCheck is discarded.
    expect(finding.sourceChecks).toHaveLength(0);
  });

  it("falls back to abstain and clamps confidence on unrecognized output", async () => {
    mockFetch({
      message: {
        content: JSON.stringify({ confidence: 2, outcome: "approve" }),
      },
    });

    const finding = await resolveWithOllama({
      config,
      evidence: [],
      nowMs: 0,
      request,
    });

    expect(finding.outcome).toBe("abstain");
    expect(finding.confidence).toBe(1);
  });

  it("throws on a non-ok Ollama response", async () => {
    mockFetch({}, false);

    await expect(
      resolveWithOllama({ config, evidence: [], nowMs: 0, request }),
    ).rejects.toThrow("Ollama returned HTTP 500.");
  });
});
