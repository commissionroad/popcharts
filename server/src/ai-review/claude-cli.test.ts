import { describe, expect, it } from "bun:test";

import { reviewWithClaudeCli, type ClaudeCliRunner } from "./claude-cli";
import type { MarketReviewRequest } from "./types";

const REQUEST: MarketReviewRequest = {
  metadata: {
    question: "Will the measured value exceed 42 by December 31, 2026?",
    resolutionCriteria:
      "Resolves YES if the official published value exceeds 42.",
    resolutionSources: ["https://example.com/data"],
  },
};

const CONFIG = {
  claudeCliCommand: "claude",
  claudeCliModel: "sonnet",
  requestTimeoutMs: 60_000,
};

function runnerReturning(
  envelope: unknown,
  captured?: { argv?: string[]; env?: Record<string, string | undefined> },
): ClaudeCliRunner {
  return ({ argv, env }) => {
    if (captured) {
      captured.argv = argv;
      captured.env = env;
    }
    return Promise.resolve({
      exitCode: 0,
      stdout:
        typeof envelope === "string" ? envelope : JSON.stringify(envelope),
    });
  };
}

describe("reviewWithClaudeCli", () => {
  it("parses a well-formed review from the envelope result", async () => {
    const captured: { argv?: string[] } = {};
    const finding = await reviewWithClaudeCli({
      config: CONFIG,
      request: REQUEST,
      runCommand: runnerReturning(
        {
          result: JSON.stringify({
            hardFlags: [],
            reasons: ["The market is measurable and publicly resolvable."],
            scoreRationales: {
              contentSafety: "No harmful content.",
              corroboration: "The official source can verify the result.",
              disputeRisk: "The threshold and deadline are explicit.",
              objectivity: "The test is binary.",
              promptInjectionRisk: "No instruction manipulation.",
              publicKnowability: "The result is public.",
              sourceQuality: "The source is primary.",
            },
            scores: {
              contentSafety: 5,
              corroboration: 4,
              disputeRisk: 1,
              objectivity: 5,
              promptInjectionRisk: 0,
              publicKnowability: 5,
              sourceQuality: 5,
            },
            sourceChecks: [
              {
                domain: "example.com",
                notes: "Official data source.",
                relevant: true,
                sourceTier: "primary",
                url: "https://example.com/data",
              },
            ],
            verdict: "approve",
          }),
        },
        captured,
      ),
    });

    expect(finding.verdict).toBe("approve");
    expect(finding.scores.objectivity).toBe(5);
    expect(finding.reasons).toEqual([
      "The market is measurable and publicly resolvable.",
    ]);
    expect(finding.scoreRationales.objectivity).toBe("The test is binary.");
    expect(finding.modelId).toBe("sonnet");
    expect(finding.sourceChecks).toHaveLength(1);
    expect(captured.argv).toEqual([
      "claude",
      "-p",
      expect.any(String),
      "--model",
      "sonnet",
      "--allowedTools",
      "WebSearch,WebFetch",
      "--output-format",
      "json",
    ]);
  });

  it("throws on a non-zero exit code", () => {
    expect(
      reviewWithClaudeCli({
        config: CONFIG,
        request: REQUEST,
        runCommand: () => Promise.resolve({ exitCode: 1, stdout: "" }),
      }),
    ).rejects.toThrow("exited with code 1");
  });

  it("throws when the envelope reports is_error", () => {
    expect(
      reviewWithClaudeCli({
        config: CONFIG,
        request: REQUEST,
        runCommand: runnerReturning({
          is_error: true,
          result: "usage limit reached",
        }),
      }),
    ).rejects.toThrow("usage limit reached");
  });

  it("throws on a non-JSON envelope", () => {
    expect(
      reviewWithClaudeCli({
        config: CONFIG,
        request: REQUEST,
        runCommand: runnerReturning("not json at all"),
      }),
    ).rejects.toThrow("did not return a JSON envelope");
  });

  it("strips ANTHROPIC_API_KEY so the CLI uses subscription auth", async () => {
    const captured: { env?: Record<string, string | undefined> } = {};
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-leak";
    try {
      await reviewWithClaudeCli({
        config: CONFIG,
        request: REQUEST,
        runCommand: runnerReturning(
          { result: JSON.stringify({ verdict: "manual_review" }) },
          captured,
        ),
      });
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }

    expect(captured.env?.ANTHROPIC_API_KEY).toBeUndefined();
  });
});
