import { describe, expect, it } from "bun:test";

import type { ReviewResult, ReviewVerdict } from "src/ai-review/types";
import {
  corroborateReview,
  isDeterministicReject,
  isTerminalReviewVerdict,
} from "./corroboration";

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
    provider: "heuristic",
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

describe("verdict classification helpers", () => {
  it("marks approve and reject terminal, manual_review not", () => {
    expect(isTerminalReviewVerdict("approve")).toBe(true);
    expect(isTerminalReviewVerdict("reject")).toBe(true);
    expect(isTerminalReviewVerdict("manual_review")).toBe(false);
  });

  it("treats only hard-flagged rejects as deterministic", () => {
    expect(
      isDeterministicReject(
        reviewResult("reject", { hardFlags: ["death_market"] }),
      ),
    ).toBe(true);
    expect(isDeterministicReject(reviewResult("reject"))).toBe(false);
    expect(
      isDeterministicReject(
        reviewResult("approve", { hardFlags: ["death_market"] }),
      ),
    ).toBe(false);
  });
});

describe("corroborateReview", () => {
  it("commits manual_review on a single run", async () => {
    const service = scriptedService([reviewResult("manual_review")]);
    const corroborated = await corroborateReview(service);

    expect(corroborated.outcome).toBe("single_pass");
    expect(corroborated.result.verdict).toBe("manual_review");
    expect(corroborated.runs).toHaveLength(1);
    expect(service.calls()).toBe(1);
  });

  it("commits deterministic hard-flag rejects on a single run", async () => {
    const service = scriptedService([
      reviewResult("reject", { hardFlags: ["prompt_injection"] }),
    ]);
    const corroborated = await corroborateReview(service);

    expect(corroborated.outcome).toBe("single_pass");
    expect(corroborated.result.verdict).toBe("reject");
    expect(service.calls()).toBe(1);
  });

  it("confirms approve with one agreeing second run", async () => {
    const first = reviewResult("approve");
    const second = reviewResult("approve", { reasons: ["second opinion"] });
    const service = scriptedService([first, second]);
    const corroborated = await corroborateReview(service);

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
    const corroborated = await corroborateReview(service);

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
    const corroborated = await corroborateReview(service);

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
    const corroborated = await corroborateReview(service);

    expect(corroborated.outcome).toBe("tiebreak_confirmed");
    expect(corroborated.result.verdict).toBe("reject");
  });

  it("demotes to manual_review when no terminal majority forms", async () => {
    const service = scriptedService([
      reviewResult("approve", { reasons: ["original approval"] }),
      reviewResult("manual_review"),
      reviewResult("manual_review"),
    ]);
    const corroborated = await corroborateReview(service);

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
    const corroborated = await corroborateReview(service);

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
      ...service,
      onBeforeRun: async (run) => {
        renewedBefore.push(run);
      },
    });

    expect(renewedBefore).toEqual([2, 3]);
  });

  it("propagates service errors so job retry semantics stay intact", async () => {
    const service = {
      callService: async () => {
        throw new Error("service unreachable");
      },
    };

    await expect(corroborateReview(service)).rejects.toThrow(
      "service unreachable",
    );
  });
});
