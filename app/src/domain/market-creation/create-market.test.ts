import { describe, expect, test } from "vitest";

import {
  applyGraduationTime,
  applyResolutionTime,
  buildCreateMarketPreview,
  buildMarketMetadata,
  buildProtocolCreateMarketParams,
  createInitialMarketDraft,
  createMetadataHash,
  dateTimeLocalToDate,
  deriveGraduationThreshold,
  formatDeadline,
  MAX_OUTCOME_LABEL_LENGTH,
  serializeMarketMetadata,
  toDateTimeLocalValue,
  validateCreateMarketDraft,
} from "./create-market";
import type { CreateMarketDraft } from "./types";

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

  test("carries trimmed outcome labels into metadata and drops blank ones", () => {
    const draft = {
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      outcomeNo: "   ",
      outcomeYes: "  Argentina ",
      question: "Will ARG beat EGY?",
      resolutionCriteria: "YES if ARG wins.",
    };
    const metadata = buildMarketMetadata(draft);

    expect(metadata.outcomeYes).toBe("Argentina");
    expect(metadata.outcomeNo).toBeUndefined();
  });

  test("rejects outcome labels above the length limit", () => {
    const draft = {
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      outcomeNo: "n".repeat(MAX_OUTCOME_LABEL_LENGTH + 1),
      outcomeYes: "y".repeat(MAX_OUTCOME_LABEL_LENGTH + 1),
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
    };

    expect(
      validateCreateMarketDraft(draft, new Date("2026-06-13T12:00:00Z"))
    ).toMatchObject({
      outcomeNo: `Keep the NO label under ${MAX_OUTCOME_LABEL_LENGTH} characters.`,
      outcomeYes: `Keep the YES label under ${MAX_OUTCOME_LABEL_LENGTH} characters.`,
    });
  });

  test("serializes labeled metadata in the canonical indexer field order", () => {
    // Must stay byte-identical with the server indexer's serializer
    // (server/src/indexer/metadata/market-metadata.ts) or on-chain markets
    // carrying labels fail the ingestion hash check.
    const payload = serializeMarketMetadata({
      category: "Sports",
      createdAt: "2026-07-02T12:00:00.000Z",
      description: "",
      outcomeNo: "Egypt",
      outcomeYes: "Argentina",
      question: "Will ARG beat EGY?",
      resolutionCriteria: "YES if ARG wins.",
      version: 1,
    });

    expect(payload).toBe(
      '{"version":1,"question":"Will ARG beat EGY?","description":"",' +
        '"category":"Sports","resolutionCriteria":"YES if ARG wins.",' +
        '"outcomeYes":"Argentina","outcomeNo":"Egypt",' +
        '"createdAt":"2026-07-02T12:00:00.000Z"}'
    );
  });

  test("keeps unlabeled metadata payloads unchanged", () => {
    const payload = serializeMarketMetadata({
      category: "Sports",
      createdAt: "2026-07-02T12:00:00.000Z",
      description: "",
      question: "Will ARG beat EGY?",
      resolutionCriteria: "YES if ARG wins.",
      version: 1,
    });

    expect(payload).toBe(
      '{"version":1,"question":"Will ARG beat EGY?","description":"",' +
        '"category":"Sports","resolutionCriteria":"YES if ARG wins.",' +
        '"createdAt":"2026-07-02T12:00:00.000Z"}'
    );
  });

  test("keeps resolution sources without a resolution URL", () => {
    const metadata = buildMarketMetadata({
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      resolutionSources: "News Desk, https://example.com/source",
    });

    expect(metadata.resolutionSources).toEqual([
      "News Desk",
      "https://example.com/source",
    ]);
    expect(metadata).not.toHaveProperty("resolutionUrl");
  });

  test("omits source metadata entirely when nothing is provided", () => {
    const metadata = buildMarketMetadata(
      createInitialMarketDraft(new Date("2026-06-13T12:00:00Z"))
    );

    expect(metadata).not.toHaveProperty("resolutionSources");
    expect(metadata).not.toHaveProperty("resolutionUrl");
  });

  test("rejects unsupported categories", () => {
    const draft = {
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      category: "Mystery" as CreateMarketDraft["category"],
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
    };

    expect(
      validateCreateMarketDraft(draft, new Date("2026-06-13T12:00:00Z"))
    ).toMatchObject({ category: "Choose a supported category." });
  });

  test("rejects values below the public ranges and missing deadlines", () => {
    const draft = {
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      graduationTime: "",
      liquidityParameter: 0,
      openingProbability: 1,
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
      resolutionTime: "",
    };

    expect(
      validateCreateMarketDraft(draft, new Date("2026-06-13T12:00:00Z"))
    ).toMatchObject({
      graduationThreshold: "Graduation target must be greater than zero.",
      graduationTime: "Choose a graduation deadline.",
      liquidityParameter: "Choose b from 500 to 10,000.",
      openingProbability: "Choose an opening YES probability from 2% to 98%.",
      resolutionTime: "Choose a resolution deadline.",
    });
  });

  test("rejects values above the public ranges", () => {
    const draft = {
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      liquidityParameter: 20_000,
      openingProbability: 99,
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
    };
    const nanDraft = {
      ...draft,
      liquidityParameter: Number.NaN,
      openingProbability: Number.NaN,
    };

    expect(
      validateCreateMarketDraft(draft, new Date("2026-06-13T12:00:00Z"))
    ).toMatchObject({
      liquidityParameter: "Choose b from 500 to 10,000.",
      openingProbability: "Choose an opening YES probability from 2% to 98%.",
    });
    expect(
      validateCreateMarketDraft(nanDraft, new Date("2026-06-13T12:00:00Z"))
    ).toMatchObject({
      liquidityParameter: "Choose b from 500 to 10,000.",
      openingProbability: "Choose an opening YES probability from 2% to 98%.",
    });
  });

  test("flags source URLs that cannot be parsed and accepts http and https", () => {
    const baseDraft = {
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
    };

    expect(
      validateCreateMarketDraft(
        { ...baseDraft, resolutionSources: "http://[" },
        new Date("2026-06-13T12:00:00Z")
      )
    ).toMatchObject({
      resolutionSources: "Use http or https for source URLs.",
    });
    expect(
      validateCreateMarketDraft(
        {
          ...baseDraft,
          resolutionSources: "http://example.com/a, https://example.com/b",
        },
        new Date("2026-06-13T12:00:00Z")
      )
    ).not.toHaveProperty("resolutionSources");
  });

  test("handles empty and invalid deadline values", () => {
    expect(dateTimeLocalToDate("")).toBeNull();
    expect(formatDeadline("")).toBe("Invalid date");
    expect(formatDeadline("2026-06-13T12:00")).toContain("Jun 13, 2026");
  });

  test("hashes metadata consistently with previews", () => {
    const draft = {
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
    };
    const preview = buildCreateMarketPreview(draft);

    expect(createMetadataHash(preview.metadata)).toBe(preview.metadataHash);
  });

  test("derives the metadata payload when it is not supplied", () => {
    const draft = {
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      question: "Will the demo market graduate?",
      resolutionCriteria: "Resolves YES if the demo condition is met.",
    };
    const preview = buildCreateMarketPreview(draft);
    const params = buildProtocolCreateMarketParams(draft, preview.metadataHash);

    expect(params.metadata).toBe(preview.metadataPayload);
  });

  test("encodes missing deadlines as zero unix seconds", () => {
    const preview = buildCreateMarketPreview({
      ...createInitialMarketDraft(new Date("2026-06-13T12:00:00Z")),
      graduationTime: "",
      resolutionTime: "",
    });

    expect(preview.protocolParams.graduationDeadline).toBe(0n);
    expect(preview.protocolParams.resolutionTime).toBe(0n);
  });
});
