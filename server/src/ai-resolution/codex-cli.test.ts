import { describe, expect, it } from "bun:test";

import type { CliRunner } from "src/shared/cli-runner";

import { resolveWithCodexCli } from "./codex-cli";
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
  codexCliCommand: "codex",
  codexCliModel: "gpt-5.6-luna",
  requestTimeoutMs: 60_000,
};

const RESOLUTION = {
  confidence: 0.92,
  hardFlags: [],
  outcome: "yes",
  reasons: ["The official source published a value above the threshold."],
  sourceChecks: [
    {
      domain: "example.com",
      relevant: true,
      sourceTier: "primary",
      url: "https://example.com/data",
    },
  ],
};

function runnerReturning(
  stdout: unknown,
  captured?: { argv?: string[]; env?: Record<string, string | undefined> },
): CliRunner {
  return ({ argv, env }) => {
    if (captured) {
      captured.argv = argv;
      captured.env = env;
    }
    return Promise.resolve({
      exitCode: 0,
      stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout),
    });
  };
}

describe("resolveWithCodexCli", () => {
  it("parses a well-formed resolution straight from stdout", async () => {
    const finding = await resolveWithCodexCli({
      config: CONFIG,
      nowMs: NOW,
      request: REQUEST,
      runCommand: runnerReturning(RESOLUTION),
    });

    expect(finding.outcome).toBe("yes");
    expect(finding.confidence).toBeCloseTo(0.92);
    expect(finding.modelId).toBe("gpt-5.6-luna");
    expect(finding.sourceChecks).toHaveLength(1);
  });

  it("falls back to abstain on an unrecognized outcome", async () => {
    const finding = await resolveWithCodexCli({
      config: CONFIG,
      nowMs: NOW,
      request: REQUEST,
      runCommand: runnerReturning({ ...RESOLUTION, outcome: "probably" }),
    });

    expect(finding.outcome).toBe("abstain");
  });

  it("runs a read-only exec with web search enabled", async () => {
    const captured: { argv?: string[] } = {};
    await resolveWithCodexCli({
      config: CONFIG,
      nowMs: NOW,
      request: REQUEST,
      runCommand: runnerReturning(RESOLUTION, captured),
    });

    const argv = captured.argv ?? [];
    // Asserted as an exact list rather than by `toContain`, because a presence
    // check happily passes for a flag `codex exec` rejects: `--ask-for-approval`
    // reads as reasonable but the CLI refuses to parse it. Every flag below was
    // run against codex-cli 0.144.4; the prompt is the final element.
    expect(argv.slice(0, -1)).toEqual([
      "codex",
      "exec",
      "--model",
      "gpt-5.6-luna",
      "--sandbox",
      "read-only",
      "--skip-git-repo-check",
      "--ephemeral",
      // `--search` is TUI-only, so headless runs enable search via config.
      "-c",
      'web_search="live"',
    ]);
  });

  it("passes the current time into the prompt rather than letting the model assume it", async () => {
    const captured: { argv?: string[] } = {};
    await resolveWithCodexCli({
      config: CONFIG,
      nowMs: NOW,
      request: REQUEST,
      runCommand: runnerReturning(RESOLUTION, captured),
    });

    expect(captured.argv?.at(-1)).toContain("2026-07-22T12:00:00.000Z");
  });

  it("surfaces the stderr reason on failure", async () => {
    // Codex writes its progress and errors to stderr and leaves stdout empty,
    // so without this the exit code is the only diagnostic.
    await expect(
      resolveWithCodexCli({
        config: CONFIG,
        nowMs: NOW,
        request: REQUEST,
        runCommand: () =>
          Promise.resolve({
            exitCode: 1,
            stderr: "ERROR: model not supported with a ChatGPT account.",
            stdout: "",
          }),
      }),
    ).rejects.toThrow(/model not supported with a ChatGPT account/);
  });
});
