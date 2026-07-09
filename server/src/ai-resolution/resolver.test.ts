import { describe, expect, it } from "bun:test";

import { aiResolutionConfig } from "./config";
import { deriveVerdict, resolveMarket } from "./resolver";
import type { MarketResolutionRequest } from "./types";

function request(criteria: string): MarketResolutionRequest {
  return {
    metadata: {
      question: "Did the event happen?",
      resolutionCriteria: criteria,
    },
    options: { internetAccess: "off", provider: "heuristic" },
  };
}

const NOW = 1_780_000_000_000;

describe("deriveVerdict", () => {
  it("re-queues a too_early outcome", () => {
    expect(deriveVerdict("too_early", 1, 3, 0.85)).toBe("requeue_too_early");
  });

  it("parks a draw for operator confirmation", () => {
    expect(deriveVerdict("draw", 1, 3, 0.85)).toBe("cancel_draw");
  });

  it("auto-resolves a confident, evidenced yes/no", () => {
    expect(deriveVerdict("yes", 0.9, 1, 0.85)).toBe("resolve_yes");
    expect(deriveVerdict("no", 0.85, 2, 0.85)).toBe("resolve_no");
  });

  it("parks a decided outcome below the threshold", () => {
    expect(deriveVerdict("yes", 0.8, 3, 0.85)).toBe("manual_review");
  });

  it("parks a decided outcome with no evidence", () => {
    expect(deriveVerdict("yes", 0.99, 0, 0.85)).toBe("manual_review");
  });

  it("parks a decided outcome with null confidence", () => {
    expect(deriveVerdict("no", null, 3, 0.85)).toBe("manual_review");
  });

  it("parks an abstain outcome", () => {
    expect(deriveVerdict("abstain", null, 0, 0.85)).toBe("manual_review");
  });
});

describe("resolveMarket (heuristic provider)", () => {
  it("auto-resolves a YES marker with a synthetic evidence item", async () => {
    const result = await resolveMarket({
      config: aiResolutionConfig,
      nowMs: NOW,
      request: request("Resolves YES per the rules. [heuristic-outcome: yes]"),
    });

    expect(result.outcome).toBe("yes");
    expect(result.verdict).toBe("resolve_yes");
    expect(result.confidence).toBe(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.provider).toBe("heuristic");
    expect(result.promptVersion).toBe("market-ai-resolution-v1");
  });

  it("parks a market with no marker as manual_review", async () => {
    const result = await resolveMarket({
      config: aiResolutionConfig,
      nowMs: NOW,
      request: request("Resolve from the news."),
    });

    expect(result.outcome).toBe("abstain");
    expect(result.verdict).toBe("manual_review");
    expect(result.evidence).toHaveLength(0);
  });

  it("re-queues a too_early marker", async () => {
    const result = await resolveMarket({
      config: aiResolutionConfig,
      nowMs: NOW,
      request: request("Not over yet. [heuristic-outcome: too_early]"),
    });

    expect(result.outcome).toBe("too_early");
    expect(result.verdict).toBe("requeue_too_early");
  });

  it("parks a draw marker for operator confirmation", async () => {
    const result = await resolveMarket({
      config: aiResolutionConfig,
      nowMs: NOW,
      request: request("It was a tie. [heuristic-outcome: draw]"),
    });

    expect(result.verdict).toBe("cancel_draw");
  });

  it("fail-safes to manual_review when the provider is not implemented", async () => {
    const result = await resolveMarket({
      config: aiResolutionConfig,
      nowMs: NOW,
      request: {
        metadata: {
          question: "Did it happen?",
          resolutionCriteria: "[heuristic-outcome: yes]",
        },
        options: { provider: "ollama" },
      },
    });

    expect(result.verdict).toBe("manual_review");
    expect(result.provider).toBe("ollama");
    expect(result.hardFlags).toContain("service_error");
  });
});
