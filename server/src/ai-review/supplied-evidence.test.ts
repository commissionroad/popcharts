import { describe, expect, it } from "bun:test";

import {
  buildSuppliedEvidenceSystemPrompt,
  buildSuppliedEvidenceUserMessage,
} from "./supplied-evidence";
import type { EvidenceItem, MarketReviewRequest } from "./types";

const REQUEST: MarketReviewRequest = {
  context: { chainId: 31337, marketId: "7" },
  metadata: {
    question: "Will the measured value exceed 42 by December 31, 2026?",
    resolutionCriteria: "Resolves YES if the official value exceeds 42.",
    resolutionSources: ["https://example.com/data"],
  },
};

const EVIDENCE: EvidenceItem[] = [
  {
    domain: "example.com",
    kind: "fetched_page",
    sourceTier: "primary",
    summary: "The official value is 44.",
    title: "Official data",
    url: "https://example.com/data",
  },
];

describe("supplied-evidence prompt", () => {
  it("is one prompt, so a provider comparison varies only the model", () => {
    // The guarantee this module exists for: every provider running in
    // precollected mode sends byte-identical instructions. If a provider ever
    // builds its own again, the eval stops measuring the model.
    const a = buildSuppliedEvidenceSystemPrompt();
    const b = buildSuppliedEvidenceSystemPrompt();
    expect(a).toBe(b);
    expect(a).toContain("Do not invent sources");
    expect(a).toContain(
      "sourceChecks must reference only URLs present in the evidence array",
    );
  });

  it("tells the model to withhold credit when evidence is empty", () => {
    expect(buildSuppliedEvidenceSystemPrompt()).toContain(
      "If evidence is empty, return sourceChecks: [] and keep corroboration and sourceQuality at 0 or 1.",
    );
  });

  it("carries the evidence and the market, and nothing else", () => {
    const parsed = JSON.parse(
      buildSuppliedEvidenceUserMessage({
        evidence: EVIDENCE,
        request: REQUEST,
      }),
    );

    expect(Object.keys(parsed).sort()).toEqual([
      "evidence",
      "market",
      "metadata",
    ]);
    expect(parsed.evidence).toEqual(EVIDENCE);
    expect(parsed.metadata.question).toBe(REQUEST.metadata.question);
    expect(parsed.market).toEqual(REQUEST.context);
  });

  it("emits an empty evidence array rather than omitting it", () => {
    // The model is told what an empty array means; leaving the key out
    // entirely would make that instruction unreachable.
    const parsed = JSON.parse(
      buildSuppliedEvidenceUserMessage({ evidence: [], request: REQUEST }),
    );
    expect(parsed.evidence).toEqual([]);
  });
});
