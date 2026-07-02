import { describe, expect, test } from "vitest";

import {
  applyGraduationTime,
  applyResolutionTime,
  buildCreateMarketPreview,
  createInitialMarketDraft,
  deriveGraduationThreshold,
  toDateTimeLocalValue,
  validateCreateMarketDraft,
} from "./create-market";

describe("market creation draft", () => {
  test("derives graduation target from b", () => {
    expect(deriveGraduationThreshold(5_000)).toBe(2_500);
    expect(deriveGraduationThreshold(750)).toBe(375);
  });

  test("validates required creation fields", () => {
    const draft = createInitialMarketDraft(new Date("2026-06-13T12:00:00Z"));

    expect(draft.graduationPreset).toBe("1h");
    expect(draft.resolutionPreset).toBe("1w");
    expect(
      validateCreateMarketDraft(draft, new Date("2026-06-13T12:00:00Z"))
    ).toMatchObject({
      question: "Add a market question.",
      resolutionCriteria: "Add resolution criteria.",
    });
  });

  test("tracks preset deadline selection until manual edits", () => {
    const draft = createInitialMarketDraft(new Date("2026-06-13T12:00:00Z"));
    const graduation = applyGraduationTime(draft, "2026-06-13T18:00", "6h");
    const customGraduation = applyGraduationTime(graduation, "2026-06-13T18:30");
    const resolution = applyResolutionTime(draft, "2026-06-14T12:00", "1d");
    const customResolution = applyResolutionTime(resolution, "2026-06-15T12:00");

    expect(graduation.graduationPreset).toBe("6h");
    expect(customGraduation.graduationPreset).toBe("custom");
    expect(resolution.resolutionPreset).toBe("1d");
    expect(customResolution.resolutionPreset).toBe("custom");
  });

  test("rejects unsupported resolution URLs and deadline ordering", () => {
    const baseDraft = createInitialMarketDraft(new Date("2026-06-13T12:00:00Z"));
    const draft = {
      ...baseDraft,
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
      resolutionSources: "News Desk, ftp://example.com/source",
      resolutionTime: baseDraft.graduationTime,
      resolutionUrl: "ftp://example.com/source",
    };

    expect(
      validateCreateMarketDraft(draft, new Date("2026-06-13T12:00:00Z"))
    ).toMatchObject({
      graduationTime: "Graduation deadline must be before resolution.",
      resolutionTime: "Resolution deadline must be after graduation.",
      resolutionSources: "Use http or https for source URLs.",
      resolutionUrl: "Use a valid http or https URL.",
    });
  });

  test("marks individual deadline fields for invalid or past dates", () => {
    const draft = {
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      graduationTime: "0123-06-13T17:27",
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
      resolutionTime: "0122-06-20T16:27",
    };

    expect(
      validateCreateMarketDraft(draft, new Date("2026-06-13T12:00:00Z"))
    ).toMatchObject({
      graduationTime: "Graduation deadline must be in the future.",
      resolutionTime: "Resolution deadline must be in the future.",
    });
  });

  test("marks graduation too when resolution is before it but has its own error", () => {
    const draft = {
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      graduationTime: toDateTimeLocalValue(new Date("2026-06-13T13:00:00Z")),
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
      resolutionTime: toDateTimeLocalValue(new Date("2026-06-13T11:00:00Z")),
    };

    expect(
      validateCreateMarketDraft(draft, new Date("2026-06-13T12:00:00Z"))
    ).toMatchObject({
      graduationTime: "Graduation deadline must be before resolution.",
      resolutionTime: "Resolution deadline must be in the future.",
    });
  });

  test("marks nonsensical deadline fields individually", () => {
    const draft = {
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      graduationTime: "not-a-date",
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
    };

    expect(
      validateCreateMarketDraft(draft, new Date("2026-06-13T12:00:00Z"))
    ).toMatchObject({
      graduationTime: "Choose a graduation deadline.",
    });
  });

  test("builds deterministic protocol-shaped previews", () => {
    const draft = {
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
      resolutionSources: "News Desk/Example Wire\nhttps://example.com/source",
      resolutionUrl: "https://example.com/source",
    };
    const firstPreview = buildCreateMarketPreview(draft);
    const secondPreview = buildCreateMarketPreview(draft);

    expect(firstPreview.metadataHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(firstPreview.metadataHash).toBe(secondPreview.metadataHash);
    expect(firstPreview.metadata.resolutionSources).toEqual([
      "News Desk",
      "Example Wire",
      "https://example.com/source",
    ]);
    expect(firstPreview.metadataPayload).toContain('"version":1');
    expect(firstPreview.graduationThreshold).toBe(2_500);
    expect(firstPreview.protocolParams.bypassAiResolution).toBe(false);
    expect(firstPreview.protocolParams.metadata).toBe(firstPreview.metadataPayload);
    expect(firstPreview.protocolParams.openingProbabilityWad).toBe(500000000000000000n);
    expect(firstPreview.protocolParams.liquidityParameter).toBe(
      5000000000000000000000n
    );
    expect(firstPreview.protocolParams.graduationThreshold).toBe(
      2500000000000000000000n
    );
  });
});
