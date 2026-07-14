import { describe, expect, it } from "bun:test";

import {
  adjustModelScoresForEvidence,
  alignScoreRationalesWithAdjustedScores,
  arrayOfStrings,
  filterSourceChecksByEvidence,
  parseModelReview,
  parseScoreRationales,
  parseSourceChecks,
  parseSourceTier,
  parseVerdict,
  unique,
} from "./response-parsing";
import { normalizeScores } from "./scoring";
import type { EvidenceItem, SourceCheck } from "./types";

function evidenceItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    domain: "example.com",
    kind: "fetched_page",
    sourceTier: "primary",
    summary: "Example summary.",
    title: "Example",
    url: "https://example.com/a",
    ...overrides,
  };
}

function sourceCheck(overrides: Partial<SourceCheck> = {}): SourceCheck {
  return {
    domain: "example.com",
    notes: "",
    relevant: true,
    sourceTier: "primary",
    url: "https://example.com/a",
    ...overrides,
  };
}

describe("parseModelReview", () => {
  it("parses a bare JSON reply", () => {
    expect(parseModelReview('{"verdict":"approve"}', "Anthropic")).toEqual({
      verdict: "approve",
    });
  });

  it("extracts JSON wrapped in prose or markdown", () => {
    const content =
      'Here is my review:\n```json\n{"verdict":"reject"}\n```\nDone.';
    expect(parseModelReview(content, "Anthropic")).toEqual({
      verdict: "reject",
    });
  });

  it("names the provider when no JSON is present", () => {
    expect(() => parseModelReview("no json here", "Ollama")).toThrow(
      "Ollama did not return JSON.",
    );
  });
});

describe("parseVerdict", () => {
  it("passes through known verdicts", () => {
    expect(parseVerdict("approve")).toBe("approve");
    expect(parseVerdict("reject")).toBe("reject");
    expect(parseVerdict("manual_review")).toBe("manual_review");
  });

  it("falls back to manual_review for anything else", () => {
    expect(parseVerdict("APPROVE")).toBe("manual_review");
    expect(parseVerdict(undefined)).toBe("manual_review");
    expect(parseVerdict(42)).toBe("manual_review");
  });
});

describe("parseScoreRationales", () => {
  it("normalizes every score rationale and fills missing dimensions", () => {
    const rationales = parseScoreRationales({
      contentSafety: "  No harmful content.  ",
      objectivity: 42,
    });

    expect(rationales.contentSafety).toBe("No harmful content.");
    expect(rationales.objectivity).toBe(
      "The reviewer did not provide a rationale for this score.",
    );
    expect(Object.keys(rationales)).toHaveLength(7);
  });
});

describe("parseSourceChecks", () => {
  it("keeps well-formed entries and normalizes their fields", () => {
    const parsed = parseSourceChecks([
      {
        domain: "example.com",
        notes: "ok",
        relevant: true,
        sourceTier: "primary",
        url: "https://example.com/a",
      },
    ]);

    expect(parsed).toEqual([
      {
        domain: "example.com",
        notes: "ok",
        relevant: true,
        sourceTier: "primary",
        url: "https://example.com/a",
      },
    ]);
  });

  it("drops entries missing a url or domain and non-objects", () => {
    expect(
      parseSourceChecks([
        { domain: "example.com" },
        { url: "https://example.com/a" },
        "not-an-object",
        null,
      ]),
    ).toEqual([]);
    expect(parseSourceChecks("not-an-array")).toEqual([]);
  });

  it("coerces unknown tiers and non-boolean relevance", () => {
    const [parsed] = parseSourceChecks([
      {
        domain: "example.com",
        relevant: "yes",
        sourceTier: "top",
        url: "https://example.com",
      },
    ]);
    expect(parsed?.sourceTier).toBe("unknown");
    expect(parsed?.relevant).toBe(false);
  });
});

describe("filterSourceChecksByEvidence", () => {
  it("returns nothing when there is no evidence", () => {
    expect(filterSourceChecksByEvidence([sourceCheck()], [])).toEqual([]);
  });

  it("keeps checks matching an evidence url or domain and drops invented ones", () => {
    const evidence = [evidenceItem()];
    const byUrl = sourceCheck({
      domain: "other.com",
      url: "https://example.com/a",
    });
    const byDomain = sourceCheck({ url: "https://example.com/other" });
    const invented = sourceCheck({
      domain: "invented.com",
      url: "https://invented.com/x",
    });

    expect(
      filterSourceChecksByEvidence([byUrl, byDomain, invented], evidence),
    ).toEqual([byUrl, byDomain]);
  });
});

describe("adjustModelScoresForEvidence", () => {
  const baseScores = normalizeScores({
    contentSafety: 3,
    corroboration: 5,
    disputeRisk: 3,
    objectivity: 3,
    promptInjectionRisk: 5,
    publicKnowability: 3,
    sourceQuality: 5,
  });

  it("caps evidence-dependent scores when no source checks survive", () => {
    const adjusted = adjustModelScoresForEvidence(baseScores, [], []);
    expect(adjusted.corroboration).toBe(1);
    expect(adjusted.sourceQuality).toBe(1);
    expect(adjusted.promptInjectionRisk).toBe(2);
  });

  it("keeps evidence-backed scores when source checks exist", () => {
    const adjusted = adjustModelScoresForEvidence(
      baseScores,
      [sourceCheck()],
      [],
    );
    expect(adjusted.corroboration).toBe(baseScores.corroboration);
    expect(adjusted.sourceQuality).toBe(baseScores.sourceQuality);
  });

  it("lets promptInjectionRisk stand only with a corroborating hard flag", () => {
    const flagged = adjustModelScoresForEvidence(
      baseScores,
      [sourceCheck()],
      ["prompt_injection_detected"],
    );
    expect(flagged.promptInjectionRisk).toBe(baseScores.promptInjectionRisk);

    const unflagged = adjustModelScoresForEvidence(
      baseScores,
      [sourceCheck()],
      ["unrelated_flag"],
    );
    expect(unflagged.promptInjectionRisk).toBe(2);
  });
});

describe("alignScoreRationalesWithAdjustedScores", () => {
  it("explains safety caps beside the final normalized scores", () => {
    const rawScores = normalizeScores({
      contentSafety: 5,
      corroboration: 4,
      disputeRisk: 1,
      objectivity: 5,
      promptInjectionRisk: 4,
      publicKnowability: 5,
      sourceQuality: 5,
    });
    const adjustedScores = adjustModelScoresForEvidence(rawScores, [], []);
    const rationales = parseScoreRationales({
      contentSafety: "Safe.",
      corroboration: "Several sources.",
      disputeRisk: "Low risk.",
      objectivity: "Objective.",
      promptInjectionRisk: "Suspicious text.",
      publicKnowability: "Public.",
      sourceQuality: "Primary source.",
    });

    const aligned = alignScoreRationalesWithAdjustedScores({
      adjustedScores,
      rationales,
      rawScores,
      sourceChecks: [],
    });

    expect(aligned.corroboration).toContain("No source check matched");
    expect(aligned.sourceQuality).toContain("No source check matched");
    expect(aligned.promptInjectionRisk).toContain(
      "no prompt-injection hard flag",
    );
    expect(aligned.objectivity).toBe("Objective.");
  });
});

describe("parseSourceTier", () => {
  it("passes through known tiers and defaults the rest to unknown", () => {
    expect(parseSourceTier("primary")).toBe("primary");
    expect(parseSourceTier("unreachable")).toBe("unreachable");
    expect(parseSourceTier("blog")).toBe("unknown");
    expect(parseSourceTier(null)).toBe("unknown");
  });
});

describe("arrayOfStrings", () => {
  it("keeps only string entries and tolerates non-arrays", () => {
    expect(arrayOfStrings(["a", 1, null, "b"])).toEqual(["a", "b"]);
    expect(arrayOfStrings("a")).toEqual([]);
  });
});

describe("unique", () => {
  it("deduplicates and drops empty values", () => {
    expect(unique(["a", "b", "a", undefined, ""])).toEqual(["a", "b"]);
  });
});
