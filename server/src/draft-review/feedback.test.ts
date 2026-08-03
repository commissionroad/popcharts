import { describe, expect, it } from "bun:test";

import type {
  ReviewResult,
  ReviewScoreRationales,
  ReviewScores,
} from "src/ai-review/types";
import { buildDraftReviewFeedback } from "./feedback";

/** Scores that trip no threshold, so score-derived items stay quiet. */
const QUIET_SCORES: ReviewScores = {
  contentSafety: 5,
  corroboration: 5,
  disputeRisk: 0,
  objectivity: 5,
  promptInjectionRisk: 0,
  publicKnowability: 5,
  sourceQuality: 5,
};

const RATIONALES: ReviewScoreRationales = {
  contentSafety: "Safe subject.",
  corroboration: "Well corroborated.",
  disputeRisk: "Clear-cut resolution.",
  objectivity: "Objective criteria.",
  promptInjectionRisk: "No injection attempts.",
  publicKnowability: "Publicly verifiable.",
  sourceQuality: "Strong sources.",
};

function makeReviewResult(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    evidence: [],
    hardFlags: [],
    promptVersion: "test-v1",
    provider: "heuristic",
    reasons: [],
    scoreRationales: RATIONALES,
    scores: QUIET_SCORES,
    sourceChecks: [],
    verdict: "approve",
    ...overrides,
  };
}

describe("buildDraftReviewFeedback hard flags", () => {
  const HARD_FLAG_TITLES: Array<[flag: string, title: string]> = [
    ["death_market", "Death and harm can't be market subjects"],
    ["violent_harm", "Violence can't be a market subject"],
    ["illegal_activity", "Markets can't turn on crimes"],
    ["sexual_exploitation", "This subject is not allowed"],
    ["prompt_injection", "Remove reviewer-directed instructions"],
    ["private_local_knowledge", "Make it publicly checkable"],
  ];

  for (const [flag, title] of HARD_FLAG_TITLES) {
    it(`maps ${flag} to its blocker item`, () => {
      const { items } = buildDraftReviewFeedback(
        makeReviewResult({ hardFlags: [flag], verdict: "reject" }),
      );

      expect(items).toHaveLength(1);
      expect(items[0]?.title).toBe(title);
      expect(items[0]?.severity).toBe("blocker");
    });
  }

  it("emits one item for a repeated hard flag", () => {
    const { items } = buildDraftReviewFeedback(
      makeReviewResult({
        hardFlags: ["death_market", "death_market"],
        verdict: "reject",
      }),
    );

    expect(items).toHaveLength(1);
  });

  it("ignores hard flags with no canonical advice", () => {
    const { items } = buildDraftReviewFeedback(
      makeReviewResult({ hardFlags: ["mystery_flag"], verdict: "reject" }),
    );

    expect(items).toEqual([]);
  });

  it("suppresses reasons that restate a hard flag but keeps unrelated ones", () => {
    const { items } = buildDraftReviewFeedback(
      makeReviewResult({
        hardFlags: ["death_market"],
        reasons: [
          "The market speculates on a person's death.",
          "The category looks wrong for this subject.",
        ],
        verdict: "reject",
      }),
    );

    expect(items.map((item) => item.title)).toEqual([
      "Death and harm can't be market subjects",
      "Reviewer note",
    ]);
    expect(items[1]?.issue).toBe("The category looks wrong for this subject.");
  });

  it("keeps flag-like reasons when no hard flag was raised", () => {
    const { items } = buildDraftReviewFeedback(
      makeReviewResult({
        reasons: ["The market speculates on a person's death."],
        verdict: "manual_review",
      }),
    );

    expect(items.map((item) => item.title)).toEqual(["Reviewer note"]);
    expect(items[0]?.issue).toBe("The market speculates on a person's death.");
  });
});

describe("buildDraftReviewFeedback soft reasons", () => {
  const SOFT_REASON_TITLES: Array<[reason: string, title: string]> = [
    [
      "The question is not phrased as a clear yes/no proposition.",
      "Phrase it as a yes/no question",
    ],
    [
      "The question asks about an already-decided past event.",
      "Ask about the future",
    ],
    [
      "Resolution depends on an ephemeral story that expires.",
      "Cite a source that will still exist",
    ],
    ["A cited source is a satirical outlet.", "Satire can't settle a market"],
  ];

  for (const [reason, title] of SOFT_REASON_TITLES) {
    it(`maps "${reason}" to its warning item`, () => {
      const { items } = buildDraftReviewFeedback(
        makeReviewResult({ reasons: [reason], verdict: "manual_review" }),
      );

      expect(items).toHaveLength(1);
      expect(items[0]?.title).toBe(title);
      expect(items[0]?.severity).toBe("warning");
    });
  }

  it("emits one item when two reasons match the same pattern", () => {
    const { items } = buildDraftReviewFeedback(
      makeReviewResult({
        reasons: [
          "The question is not phrased as a clear yes/no proposition.",
          "This is not a binary proposition at all.",
        ],
        verdict: "manual_review",
      }),
    );

    expect(items.map((item) => item.title)).toEqual([
      "Phrase it as a yes/no question",
    ]);
  });
});

describe("buildDraftReviewFeedback reviewer notes", () => {
  const UNRECOGNIZED = "The deadline phrasing is ambiguous about timezones.";

  it("turns unrecognized reasons into blocker notes on reject", () => {
    const { items } = buildDraftReviewFeedback(
      makeReviewResult({ reasons: [UNRECOGNIZED], verdict: "reject" }),
    );

    expect(items).toEqual([
      {
        howToFix:
          "Revise the draft with this in mind, then resubmit — the next review sees only the new text.",
        issue: UNRECOGNIZED,
        severity: "blocker",
        title: "Reviewer note",
      },
    ]);
  });

  it("turns unrecognized reasons into warning notes on manual_review", () => {
    const { items } = buildDraftReviewFeedback(
      makeReviewResult({ reasons: [UNRECOGNIZED], verdict: "manual_review" }),
    );

    expect(items[0]?.severity).toBe("warning");
  });

  it("turns unrecognized reasons into warning notes on approve", () => {
    const { items } = buildDraftReviewFeedback(
      makeReviewResult({ reasons: [UNRECOGNIZED], verdict: "approve" }),
    );

    expect(items[0]?.severity).toBe("warning");
  });
});

describe("buildDraftReviewFeedback score-derived items", () => {
  it("fires the source-quality item at 1 and not at 2", () => {
    const low = buildDraftReviewFeedback(
      makeReviewResult({ scores: { ...QUIET_SCORES, sourceQuality: 1 } }),
    );

    expect(low.items).toEqual([
      {
        field: "resolutionSources",
        howToFix:
          "Name one to three public sources (outlet names or URLs) a stranger could check to settle this.",
        issue: "No strong resolution source is named.",
        severity: "info",
        title: "Add resolution sources",
      },
    ]);

    const above = buildDraftReviewFeedback(
      makeReviewResult({ scores: { ...QUIET_SCORES, sourceQuality: 2 } }),
    );

    expect(above.items).toEqual([]);
  });

  it("fires the objectivity item at 2 and not at 3", () => {
    const low = buildDraftReviewFeedback(
      makeReviewResult({ scores: { ...QUIET_SCORES, objectivity: 2 } }),
    );

    expect(low.items.map((item) => item.title)).toEqual([
      "Tighten the resolution criteria",
    ]);
    expect(low.items[0]?.severity).toBe("warning");

    const above = buildDraftReviewFeedback(
      makeReviewResult({ scores: { ...QUIET_SCORES, objectivity: 3 } }),
    );

    expect(above.items).toEqual([]);
  });

  it("fires the dispute-risk item at 4 and not at 3", () => {
    const high = buildDraftReviewFeedback(
      makeReviewResult({ scores: { ...QUIET_SCORES, disputeRisk: 4 } }),
    );

    expect(high.items.map((item) => item.title)).toEqual([
      "Reduce dispute risk",
    ]);
    expect(high.items[0]?.severity).toBe("warning");

    const below = buildDraftReviewFeedback(
      makeReviewResult({ scores: { ...QUIET_SCORES, disputeRisk: 3 } }),
    );

    expect(below.items).toEqual([]);
  });

  it("never duplicates a titled item across flags, reasons, and scores", () => {
    const { items } = buildDraftReviewFeedback(
      makeReviewResult({
        hardFlags: ["death_market", "prompt_injection", "death_market"],
        reasons: [
          "The question is not phrased as a clear yes/no proposition.",
          "Not a binary proposition.",
          "Resolution depends on an ephemeral story.",
          "Something else entirely.",
        ],
        scores: {
          ...QUIET_SCORES,
          disputeRisk: 5,
          objectivity: 0,
          sourceQuality: 0,
        },
        verdict: "reject",
      }),
    );
    const titles = items
      .map((item) => item.title)
      .filter((title) => title !== "Reviewer note");

    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("buildDraftReviewFeedback summaries", () => {
  it("summarizes each verdict with its exact line", () => {
    expect(
      buildDraftReviewFeedback(makeReviewResult({ verdict: "approve" }))
        .summary,
    ).toBe("Approved — this market is ready to publish.");
    expect(
      buildDraftReviewFeedback(makeReviewResult({ verdict: "manual_review" }))
        .summary,
    ).toBe(
      "Almost there — fix the flagged issues below and resubmit for review.",
    );
    expect(
      buildDraftReviewFeedback(makeReviewResult({ verdict: "reject" })).summary,
    ).toBe("This market can't run as written — address the blockers below.");
  });
});
