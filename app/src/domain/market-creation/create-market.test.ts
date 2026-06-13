import { describe, expect, test } from "vitest";

import {
  buildCreateMarketPreview,
  createInitialMarketDraft,
  deriveGraduationThreshold,
  validateCreateMarketDraft,
} from "./create-market";

describe("market creation draft", () => {
  test("derives graduation target from b", () => {
    expect(deriveGraduationThreshold(5_000)).toBe(2_500);
    expect(deriveGraduationThreshold(750)).toBe(375);
  });

  test("validates required creation fields", () => {
    const draft = createInitialMarketDraft(new Date("2026-06-13T12:00:00Z"));

    expect(
      validateCreateMarketDraft(draft, new Date("2026-06-13T12:00:00Z"))
    ).toMatchObject({
      question: "Add a market question.",
      resolutionCriteria: "Add resolution criteria.",
    });
  });

  test("rejects unsupported resolution URLs and deadline ordering", () => {
    const baseDraft = createInitialMarketDraft(new Date("2026-06-13T12:00:00Z"));
    const draft = {
      ...baseDraft,
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
      resolutionTime: baseDraft.graduationTime,
      resolutionUrl: "ftp://example.com/source",
    };

    expect(
      validateCreateMarketDraft(draft, new Date("2026-06-13T12:00:00Z"))
    ).toMatchObject({
      resolutionTime: "Resolution deadline must be after graduation.",
      resolutionUrl: "Use a valid http or https URL.",
    });
  });

  test("builds deterministic protocol-shaped previews", () => {
    const draft = {
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
      resolutionUrl: "https://example.com/source",
    };
    const firstPreview = buildCreateMarketPreview(draft);
    const secondPreview = buildCreateMarketPreview(draft);

    expect(firstPreview.metadataHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(firstPreview.metadataHash).toBe(secondPreview.metadataHash);
    expect(firstPreview.graduationThreshold).toBe(2_500);
    expect(firstPreview.protocolParams.openingProbabilityWad).toBe(500000000000000000n);
    expect(firstPreview.protocolParams.liquidityParameter).toBe(
      5000000000000000000000n
    );
    expect(firstPreview.protocolParams.graduationThreshold).toBe(
      2500000000000000000000n
    );
  });
});
