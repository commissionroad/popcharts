import { describe, expect, it } from "bun:test";

import type {
  ReviewProviderName,
  ReviewResult,
  ReviewVerdict,
} from "src/ai-review/types";
import {
  corroborateReview,
  isDeterministicReject,
  isTerminalReviewVerdict,
} from "src/draft-review/corroboration";

const scores = {
  contentSafety: 5,
  corroboration: 3,
  disputeRisk: 4,
  objectivity: 4,
  promptInjectionRisk: 0,
  publicKnowability: 4,
  sourceQuality: 4,
};

const scoreRationales = Object.fromEntries(
  Object.keys(scores).map((key) => [key, `${key} rationale`]),
) as ReviewResult["scoreRationales"];

function reviewResult(
  verdict: ReviewVerdict,
  overrides: Partial<ReviewResult> = {},
): ReviewResult {
  return {
    evidence: [],
    hardFlags: [],
    provider: "ollama",
    promptVersion: "market-ai-review-v5",
    reasons: [`${verdict} because of test fixtures`],
    scoreRationales,
    scores,
    sourceChecks: [],
    verdict,
    ...overrides,
  };
}

/** callService stub that replays scripted results and counts calls. */
function scriptedService(results: ReviewResult[]) {
  let calls = 0;
  return {
    callService: async () => {
      const result = results[calls];
      calls += 1;
      if (!result) {
        throw new Error(`Unexpected corroboration call #${calls}.`);
      }
      return result;
    },
    calls: () => calls,
  };
}

function corroborate(
  service: ReturnType<typeof scriptedService>,
  configuredProvider: ReviewProviderName = "ollama",
) {
  return corroborateReview({
    callService: service.callService,
    configuredProvider,
  });
}

describe("verdict classification helpers", () => {
  it("marks approve and reject terminal, manual_review not", () => {
    expect(isTerminalReviewVerdict("approve")).toBe(true);
    expect(isTerminalReviewVerdict("reject")).toBe(true);
    expect(isTerminalReviewVerdict("manual_review")).toBe(false);
  });

  it("treats only heuristic-provider hard-flagged rejects as deterministic", () => {
    expect(
      isDeterministicReject(
        reviewResult("reject", {
          hardFlags: ["death_market"],
          provider: "heuristic",
        }),
      ),
    ).toBe(true);
    // The default fixture provider is a model: hard flags alone never prove
    // the pre-stage, because the merge folds model-invented hard flags into
    // model results too.
    expect(
      isDeterministicReject(
        reviewResult("reject", { hardFlags: ["death_market"] }),
      ),
    ).toBe(false);
    expect(isDeterministicReject(reviewResult("reject"))).toBe(false);
    expect(
      isDeterministicReject(reviewResult("reject", { provider: "heuristic" })),
    ).toBe(false);
    expect(
      isDeterministicReject(
        reviewResult("approve", {
          hardFlags: ["death_market"],
          provider: "heuristic",
        }),
      ),
    ).toBe(false);
  });
});

describe("corroborateReview", () => {
  it("commits manual_review on a single run", async () => {
    const service = scriptedService([reviewResult("manual_review")]);
    const corroborated = await corroborate(service);

    expect(corroborated.outcome).toBe("single_pass");
    expect(corroborated.result.verdict).toBe("manual_review");
    expect(corroborated.runs).toHaveLength(1);
    expect(service.calls()).toBe(1);
  });

  it("commits the pre-stage's hard-flag reject on a single run under a model provider", async () => {
    // The pre-stage stamps provider "heuristic"; under the configured model
    // provider (the corroborate helper default) that reject is exactly
    // reproducible, so the single-pass exemption holds.
    const service = scriptedService([
      reviewResult("reject", {
        hardFlags: ["prompt_injection"],
        provider: "heuristic",
      }),
    ]);
    const corroborated = await corroborate(service);

    expect(corroborated.outcome).toBe("single_pass");
    expect(corroborated.result.verdict).toBe("reject");
    expect(service.calls()).toBe(1);
  });

  it("corroborates a model-provider reject that carries hard flags", async () => {
    // A model can invent hard flags; that reject is model judgment, not the
    // deterministic pre-stage, so it must be confirmed by a second run.
    const service = scriptedService([
      reviewResult("reject", { hardFlags: ["death_market"] }),
      reviewResult("reject", { hardFlags: ["death_market"] }),
    ]);
    const corroborated = await corroborate(service);

    expect(corroborated.outcome).toBe("confirmed");
    expect(corroborated.result.verdict).toBe("reject");
    expect(service.calls()).toBe(2);
  });

  it("commits terminal verdicts from the configured heuristic provider on a single run", async () => {
    const service = scriptedService([
      reviewResult("approve", { provider: "heuristic" }),
    ]);
    const corroborated = await corroborate(service, "heuristic");

    expect(corroborated.outcome).toBe("single_pass");
    expect(corroborated.result.verdict).toBe("approve");
    expect(service.calls()).toBe(1);
  });

  it("still corroborates a degraded heuristic result under a model provider", async () => {
    // A provider outage degrades the result to provider "heuristic"; the
    // exemption keys on the configured provider, so a second run still runs.
    const first = reviewResult("approve", { provider: "heuristic" });
    const second = reviewResult("approve");
    const service = scriptedService([first, second]);
    const corroborated = await corroborate(service, "ollama");

    expect(corroborated.outcome).toBe("confirmed");
    expect(service.calls()).toBe(2);
  });

  it("escalates when the agreeing rerun is a degraded heuristic result", async () => {
    // Defense in depth: should the retry wiring regress, a provider outage
    // degrades a rerun to provider "heuristic". Its agreement must never
    // confirm; the vote treats it as disagreement and runs the tiebreak.
    const first = reviewResult("approve");
    const degraded = reviewResult("approve", { provider: "heuristic" });
    const third = reviewResult("approve", { reasons: ["real tiebreak"] });
    const service = scriptedService([first, degraded, third]);
    const corroborated = await corroborate(service, "ollama");

    expect(corroborated.outcome).toBe("tiebreak_confirmed");
    expect(corroborated.result).toBe(third);
    expect(service.calls()).toBe(3);
  });

  it("demotes when only a degraded heuristic rerun agrees with run 1", async () => {
    const service = scriptedService([
      reviewResult("approve"),
      reviewResult("approve", { provider: "heuristic" }),
      reviewResult("manual_review"),
    ]);
    const corroborated = await corroborate(service, "ollama");

    expect(corroborated.outcome).toBe("demoted");
    expect(corroborated.result.verdict).toBe("manual_review");
    expect(service.calls()).toBe(3);
  });

  it("never lets a degraded tiebreak run complete a terminal majority", async () => {
    const service = scriptedService([
      reviewResult("approve"),
      reviewResult("reject"),
      reviewResult("approve", { provider: "heuristic" }),
    ]);
    const corroborated = await corroborate(service, "ollama");

    expect(corroborated.outcome).toBe("demoted");
    expect(corroborated.result.verdict).toBe("manual_review");
  });

  it("confirms approve with one agreeing second run", async () => {
    const first = reviewResult("approve");
    const second = reviewResult("approve", { reasons: ["second opinion"] });
    const service = scriptedService([first, second]);
    const corroborated = await corroborate(service);

    expect(corroborated.outcome).toBe("confirmed");
    // The deciding result is the latest run so the audit trail reads
    // chronologically.
    expect(corroborated.result).toBe(second);
    expect(corroborated.runs).toEqual([first, second]);
    expect(service.calls()).toBe(2);
  });

  it("requires corroboration for model rejects without hard flags", async () => {
    const service = scriptedService([
      reviewResult("reject"),
      reviewResult("reject"),
    ]);
    const corroborated = await corroborate(service);

    expect(corroborated.outcome).toBe("confirmed");
    expect(corroborated.result.verdict).toBe("reject");
    expect(service.calls()).toBe(2);
  });

  it("uses the tiebreak to confirm a 2-of-3 terminal majority", async () => {
    const third = reviewResult("approve", { reasons: ["tiebreak"] });
    const service = scriptedService([
      reviewResult("approve"),
      reviewResult("manual_review"),
      third,
    ]);
    const corroborated = await corroborate(service);

    expect(corroborated.outcome).toBe("tiebreak_confirmed");
    expect(corroborated.result).toBe(third);
    expect(service.calls()).toBe(3);
  });

  it("lets the tiebreak flip to the disagreeing terminal verdict", async () => {
    const service = scriptedService([
      reviewResult("approve"),
      reviewResult("reject"),
      reviewResult("reject", { reasons: ["tiebreak reject"] }),
    ]);
    const corroborated = await corroborate(service);

    expect(corroborated.outcome).toBe("tiebreak_confirmed");
    expect(corroborated.result.verdict).toBe("reject");
  });

  it("demotes to manual_review when no terminal majority forms", async () => {
    const service = scriptedService([
      reviewResult("approve", { reasons: ["original approval"] }),
      reviewResult("manual_review"),
      reviewResult("manual_review"),
    ]);
    const corroborated = await corroborate(service);

    expect(corroborated.outcome).toBe("demoted");
    expect(corroborated.result.verdict).toBe("manual_review");
    expect(corroborated.result.reasons[0]).toContain("runs disagreed");
    expect(corroborated.result.reasons[0]).toContain(
      "approve, manual_review, manual_review",
    );
    // The synthesized deciding result keeps run 1's audit content.
    expect(corroborated.result.reasons).toContain("original approval");
    expect(corroborated.runs).toHaveLength(3);
  });

  it("demotes a three-way split", async () => {
    const service = scriptedService([
      reviewResult("approve"),
      reviewResult("reject"),
      reviewResult("manual_review"),
    ]);
    const corroborated = await corroborate(service);

    expect(corroborated.outcome).toBe("demoted");
    expect(corroborated.result.verdict).toBe("manual_review");
  });

  it("renews the lease before each extra run, not before the first", async () => {
    const renewedBefore: number[] = [];
    const service = scriptedService([
      reviewResult("approve"),
      reviewResult("manual_review"),
      reviewResult("approve"),
    ]);
    await corroborateReview({
      callService: service.callService,
      configuredProvider: "ollama",
      onBeforeRun: async (run) => {
        renewedBefore.push(run);
      },
    });

    expect(renewedBefore).toEqual([2, 3]);
  });

  it("propagates service errors so job retry semantics stay intact", async () => {
    await expect(
      corroborateReview({
        callService: async () => {
          throw new Error("service unreachable");
        },
        configuredProvider: "ollama",
      }),
    ).rejects.toThrow("service unreachable");
  });
});
