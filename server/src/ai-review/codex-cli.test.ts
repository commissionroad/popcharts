import { describe, expect, it } from "bun:test";

import type { CliRunner } from "src/shared/cli-runner";
import { reviewWithCodexCli } from "./codex-cli";
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
  codexCliCommand: "codex",
  codexCliModel: "gpt-5.6-luna",
  requestTimeoutMs: 60_000,
};

const REVIEW = {
  hardFlags: [],
  reasons: ["The market is measurable and publicly resolvable."],
  scoreRationales: {
    contentSafety: "No harmful content.",
    corroboration: "The official source can verify the result.",
    disputeRisk: "The threshold and deadline are explicit.",
    objectivity: "The test is binary.",
    promptInjectionRisk: "No instruction manipulation.",
    publicKnowability: "The result is public.",
    sourceQuality: "Official publisher.",
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
      relevant: true,
      sourceTier: "primary",
      url: "https://example.com/data",
    },
  ],
  verdict: "approve",
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

describe("reviewWithCodexCli", () => {
  it("parses a well-formed review straight from stdout", async () => {
    const finding = await reviewWithCodexCli({
      config: CONFIG,
      request: REQUEST,
      runCommand: runnerReturning(REVIEW),
    });

    expect(finding.verdict).toBe("approve");
    expect(finding.modelId).toBe("gpt-5.6-luna");
    expect(finding.reasons).toEqual([
      "The market is measurable and publicly resolvable.",
    ]);
    expect(finding.scores.objectivity).toBe(5);
  });

  it("gives the model's claimed sources no evidence credit", async () => {
    // `codex exec --json` reports only the model's own search query, never the
    // URLs the hosted search returned, so nothing here can corroborate a
    // sourceCheck. Unbacked claims are dropped rather than trusted.
    const finding = await reviewWithCodexCli({
      config: CONFIG,
      request: REQUEST,
      runCommand: runnerReturning(REVIEW),
    });

    expect(finding.sourceChecks).toEqual([]);
    expect(finding.scores.corroboration).toBe(1);
    expect(finding.scores.sourceQuality).toBe(1);
    expect(finding.scoreRationales.sourceQuality).toContain(
      "No source check matched the collected evidence",
    );
  });

  it("coerces scores the model emitted as strings", async () => {
    const finding = await reviewWithCodexCli({
      config: CONFIG,
      request: REQUEST,
      runCommand: runnerReturning({
        ...REVIEW,
        scores: Object.fromEntries(
          Object.entries(REVIEW.scores).map(([key, value]) => [
            key,
            String(value),
          ]),
        ),
      }),
    });

    // Without coercion these silently fall back to the conservative
    // DEFAULT_SCORES (objectivity 0, publicKnowability 0) with no error.
    // Asserted on dimensions the no-evidence cap leaves alone, so the cap
    // cannot mask a coercion failure.
    expect(finding.scores.objectivity).toBe(5);
    expect(finding.scores.publicKnowability).toBe(5);
  });

  it("runs a read-only exec with web search enabled", async () => {
    const captured: { argv?: string[] } = {};
    await reviewWithCodexCli({
      config: CONFIG,
      request: REQUEST,
      runCommand: runnerReturning(REVIEW, captured),
    });

    const argv = captured.argv ?? [];
    // Asserted as an exact list rather than by `toContain`, because a
    // presence check happily passes for a flag `codex exec` rejects: an
    // earlier revision passed `--ask-for-approval never`, which the CLI
    // refuses to parse, and a contains-style assertion confirmed the mistake
    // instead of catching it. Every flag below was run against codex-cli
    // 0.144.4; the prompt is the final element.
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

  it("passes the API key through so host credential precedence applies", async () => {
    const captured: { env?: Record<string, string | undefined> } = {};
    process.env.CODEX_API_KEY = "test-key";

    try {
      await reviewWithCodexCli({
        config: CONFIG,
        request: REQUEST,
        runCommand: runnerReturning(REVIEW, captured),
      });

      expect(captured.env?.CODEX_API_KEY).toBe("test-key");
    } finally {
      delete process.env.CODEX_API_KEY;
    }
  });

  it("throws when the CLI exits non-zero", async () => {
    await expect(
      reviewWithCodexCli({
        config: CONFIG,
        request: REQUEST,
        runCommand: () => Promise.resolve({ exitCode: 1, stdout: "" }),
      }),
    ).rejects.toThrow("codex CLI exited with code 1.");
  });

  it("surfaces the stderr reason on failure", async () => {
    // Codex writes its progress and errors to stderr and leaves stdout empty,
    // so without this the exit code is the only diagnostic.
    await expect(
      reviewWithCodexCli({
        config: CONFIG,
        request: REQUEST,
        runCommand: () =>
          Promise.resolve({
            exitCode: 1,
            stderr:
              "ERROR: The 'gpt-5.1-codex-mini' model is not supported when using Codex with a ChatGPT account.",
            stdout: "",
          }),
      }),
    ).rejects.toThrow(/not supported when using Codex with a ChatGPT account/);
  });

  it("uses an explicit model override ahead of the configured one", async () => {
    const finding = await reviewWithCodexCli({
      config: CONFIG,
      model: "gpt-5.1-codex-mini",
      request: REQUEST,
      runCommand: runnerReturning(REVIEW),
    });

    expect(finding.modelId).toBe("gpt-5.1-codex-mini");
  });
});
