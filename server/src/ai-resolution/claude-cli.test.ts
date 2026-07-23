import { describe, expect, it } from "bun:test";

import { resolveWithClaudeCli, type ClaudeCliRunner } from "./claude-cli";
import type { MarketResolutionRequest } from "./types";

const NOW = Date.parse("2026-07-22T12:00:00.000Z");

const REQUEST: MarketResolutionRequest = {
  metadata: {
    question: "Did the measured value exceed 42?",
    resolutionCriteria: "Resolves YES if the published value exceeds 42.",
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

describe("resolveWithClaudeCli", () => {
  it("parses a well-formed resolution from the envelope result", async () => {
    const captured: { argv?: string[] } = {};
    const finding = await resolveWithClaudeCli({
      config: CONFIG,
      nowMs: NOW,
      request: REQUEST,
      runCommand: runnerReturning(
        {
          result: JSON.stringify({
            confidence: 0.97,
            hardFlags: [],
            outcome: "yes",
            reasons: ["The published value was 47."],
            sourceChecks: [
              {
                domain: "example.com",
                relevant: true,
                sourceTier: "primary",
                url: "https://example.com/data",
              },
            ],
          }),
        },
        captured,
      ),
    });

    expect(finding.outcome).toBe("yes");
    expect(finding.confidence).toBe(0.97);
    expect(finding.modelId).toBe("sonnet");
    expect(finding.sourceChecks).toHaveLength(1);
    // The CLI must be driven headless with search enabled and JSON output.
    expect(captured.argv).toContain("-p");
    expect(captured.argv).toContain("--allowedTools");
    expect(captured.argv).toContain("WebSearch,WebFetch");
    expect(captured.argv).toContain("--output-format");
  });

  it("strips ANTHROPIC_API_KEY so the CLI uses subscription auth", async () => {
    const captured: { env?: Record<string, string | undefined> } = {};
    process.env.ANTHROPIC_API_KEY = "sk-ant-should-not-leak";
    try {
      await resolveWithClaudeCli({
        config: CONFIG,
        nowMs: NOW,
        request: REQUEST,
        runCommand: runnerReturning(
          { result: JSON.stringify({ outcome: "abstain" }) },
          captured,
        ),
      });
    } finally {
      delete process.env.ANTHROPIC_API_KEY;
    }

    expect(captured.env?.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("falls back to abstain on an unrecognized outcome", async () => {
    const finding = await resolveWithClaudeCli({
      config: CONFIG,
      nowMs: NOW,
      request: REQUEST,
      runCommand: runnerReturning({
        result: JSON.stringify({ confidence: 3, outcome: "definitely" }),
      }),
    });

    expect(finding.outcome).toBe("abstain");
    expect(finding.confidence).toBe(1); // clamped
  });

  it("throws on a non-zero exit code", () => {
    expect(
      resolveWithClaudeCli({
        config: CONFIG,
        nowMs: NOW,
        request: REQUEST,
        runCommand: () => Promise.resolve({ exitCode: 1, stdout: "" }),
      }),
    ).rejects.toThrow("exited with code 1");
  });

  it("throws when the envelope reports is_error", () => {
    expect(
      resolveWithClaudeCli({
        config: CONFIG,
        nowMs: NOW,
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
      resolveWithClaudeCli({
        config: CONFIG,
        nowMs: NOW,
        request: REQUEST,
        runCommand: runnerReturning("not json at all"),
      }),
    ).rejects.toThrow("did not return a JSON envelope");
  });

  it("prefers an explicit model override over the configured model", async () => {
    const captured: { argv?: string[] } = {};
    const finding = await resolveWithClaudeCli({
      config: CONFIG,
      model: "opus",
      nowMs: NOW,
      request: REQUEST,
      runCommand: runnerReturning(
        { result: JSON.stringify({ outcome: "no" }) },
        captured,
      ),
    });

    expect(finding.modelId).toBe("opus");
    const modelFlag = captured.argv?.indexOf("--model") ?? -1;
    expect(captured.argv?.[modelFlag + 1]).toBe("opus");
  });
});
