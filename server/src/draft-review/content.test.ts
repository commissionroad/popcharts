import { describe, expect, it } from "bun:test";

import type { MarketDraftRow } from "src/db/schema/market-drafts";
import {
  DRAFT_LIMITS,
  buildDraftMetadata,
  buildDraftReviewMetadata,
  parseDraftResolutionSources,
  validateDraftForSubmission,
} from "./content";

/** A submission-valid draft row; each test overrides the field it probes. */
function makeDraft(overrides: Partial<MarketDraftRow> = {}): MarketDraftRow {
  return {
    category: "Crypto",
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    deleted: false,
    description: "A market about the bitcoin price.",
    graduationWindowSeconds: 60 * 60,
    id: 1,
    publicId: "k3f9x2mq7rt4wbnz",
    intendedCreatorAddress: null,
    isTemplate: false,
    liquidityParameter: 5000,
    openingProbability: 50,
    outcomeNo: "",
    outcomeYes: "",
    ownerUserId: "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
    publishedAt: null,
    publishedChainId: null,
    publishedMarketId: null,
    publishedTransactionHash: null,
    question: "Will bitcoin close above $100k on 2027-01-01?",
    resolutionCriteria:
      "Resolves YES if the BTC/USD daily close on 2027-01-01 exceeds 100000.",
    resolutionSources: "",
    resolutionUrl: "",
    resolutionWindowSeconds: 7 * 24 * 60 * 60,
    reviewedAt: null,
    status: "editing",
    submittedAt: null,
    submittedMetadataHash: null,
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    visibility: "private",
    ...overrides,
  };
}

describe("validateDraftForSubmission", () => {
  it("passes a complete draft with no errors", () => {
    expect(validateDraftForSubmission(makeDraft())).toEqual({});
  });

  it("requires a non-whitespace question", () => {
    const errors = validateDraftForSubmission(makeDraft({ question: "   " }));

    expect(errors.question).toBe("Add a market question.");
  });

  it("requires a non-whitespace category", () => {
    const errors = validateDraftForSubmission(makeDraft({ category: " " }));

    expect(errors.category).toBe("Choose a category.");
  });

  it("requires non-whitespace resolution criteria", () => {
    const errors = validateDraftForSubmission(
      makeDraft({ resolutionCriteria: "" }),
    );

    expect(errors.resolutionCriteria).toBe("Add resolution criteria.");
  });

  it("rejects a YES label over the length cap and allows one at it", () => {
    const atCap = "y".repeat(DRAFT_LIMITS.maxOutcomeLabelLength);

    expect(
      validateDraftForSubmission(makeDraft({ outcomeYes: atCap })).outcomeYes,
    ).toBeUndefined();
    expect(
      validateDraftForSubmission(makeDraft({ outcomeYes: `${atCap}y` }))
        .outcomeYes,
    ).toBe("Keep the YES label under 40 characters.");
  });

  it("rejects a NO label over the length cap, measured after trimming", () => {
    const atCap = "n".repeat(DRAFT_LIMITS.maxOutcomeLabelLength);

    // Surrounding whitespace does not count toward the cap.
    expect(
      validateDraftForSubmission(makeDraft({ outcomeNo: `  ${atCap}  ` }))
        .outcomeNo,
    ).toBeUndefined();
    expect(
      validateDraftForSubmission(makeDraft({ outcomeNo: `${atCap}n` }))
        .outcomeNo,
    ).toBe("Keep the NO label under 40 characters.");
  });

  it("bounds the opening probability to integers from 2 to 98", () => {
    const message = "Choose an opening YES probability from 2% to 98%.";

    expect(
      validateDraftForSubmission(makeDraft({ openingProbability: 1 }))
        .openingProbability,
    ).toBe(message);
    expect(
      validateDraftForSubmission(makeDraft({ openingProbability: 99 }))
        .openingProbability,
    ).toBe(message);
    expect(
      validateDraftForSubmission(makeDraft({ openingProbability: 50.5 }))
        .openingProbability,
    ).toBe(message);
    expect(
      validateDraftForSubmission(makeDraft({ openingProbability: 2 }))
        .openingProbability,
    ).toBeUndefined();
    expect(
      validateDraftForSubmission(makeDraft({ openingProbability: 98 }))
        .openingProbability,
    ).toBeUndefined();
  });

  it("bounds the liquidity parameter to integers from 500 to 10,000", () => {
    const message = "Choose b from 500 to 10,000.";

    expect(
      validateDraftForSubmission(makeDraft({ liquidityParameter: 499 }))
        .liquidityParameter,
    ).toBe(message);
    expect(
      validateDraftForSubmission(makeDraft({ liquidityParameter: 10_001 }))
        .liquidityParameter,
    ).toBe(message);
    expect(
      validateDraftForSubmission(makeDraft({ liquidityParameter: 500.5 }))
        .liquidityParameter,
    ).toBe(message);
    expect(
      validateDraftForSubmission(makeDraft({ liquidityParameter: 500 }))
        .liquidityParameter,
    ).toBeUndefined();
    expect(
      validateDraftForSubmission(makeDraft({ liquidityParameter: 10_000 }))
        .liquidityParameter,
    ).toBeUndefined();
  });

  it("floors the graduation window at five minutes", () => {
    expect(
      validateDraftForSubmission(makeDraft({ graduationWindowSeconds: 299 }))
        .graduationWindowSeconds,
    ).toBe("Give the market at least five minutes to graduate.");
    expect(
      validateDraftForSubmission(makeDraft({ graduationWindowSeconds: 300 }))
        .graduationWindowSeconds,
    ).toBeUndefined();
  });

  it("requires resolution strictly after the graduation deadline", () => {
    const message = "Resolution must come after the graduation deadline.";

    expect(
      validateDraftForSubmission(
        makeDraft({
          graduationWindowSeconds: 3_600,
          resolutionWindowSeconds: 3_600,
        }),
      ).resolutionWindowSeconds,
    ).toBe(message);
    expect(
      validateDraftForSubmission(
        makeDraft({
          graduationWindowSeconds: 3_600,
          resolutionWindowSeconds: 3_599,
        }),
      ).resolutionWindowSeconds,
    ).toBe(message);
    expect(
      validateDraftForSubmission(
        makeDraft({
          graduationWindowSeconds: 3_600,
          resolutionWindowSeconds: 3_601,
        }),
      ).resolutionWindowSeconds,
    ).toBeUndefined();
  });

  it("caps the resolution window at two years", () => {
    expect(
      validateDraftForSubmission(
        makeDraft({
          resolutionWindowSeconds: DRAFT_LIMITS.maxResolutionWindowSeconds + 1,
        }),
      ).resolutionWindowSeconds,
    ).toBe("Keep the resolution deadline within two years.");
    expect(
      validateDraftForSubmission(
        makeDraft({
          resolutionWindowSeconds: DRAFT_LIMITS.maxResolutionWindowSeconds,
        }),
      ).resolutionWindowSeconds,
    ).toBeUndefined();
  });

  it("accumulates independent field errors in one pass", () => {
    const errors = validateDraftForSubmission(
      makeDraft({ category: "", question: "", resolutionCriteria: "" }),
    );

    expect(Object.keys(errors).sort()).toEqual([
      "category",
      "question",
      "resolutionCriteria",
    ]);
  });
});

describe("parseDraftResolutionSources", () => {
  it("splits entries on newlines", () => {
    expect(parseDraftResolutionSources("Reuters\nAP News")).toEqual([
      "Reuters",
      "AP News",
    ]);
  });

  it("splits entries on commas", () => {
    expect(parseDraftResolutionSources("Reuters, AP News")).toEqual([
      "Reuters",
      "AP News",
    ]);
  });

  it("keeps URLs whole instead of splitting their path slashes", () => {
    expect(
      parseDraftResolutionSources(
        "https://example.com/news/article\nhttps://data.example.org/feeds",
      ),
    ).toEqual([
      "https://example.com/news/article",
      "https://data.example.org/feeds",
    ]);
  });

  it("splits bare slash-separated outlet lists", () => {
    expect(parseDraftResolutionSources("CNN / BBC / Reuters")).toEqual([
      "CNN",
      "BBC",
      "Reuters",
    ]);
  });

  it("mixes URL and bare entries within one value", () => {
    expect(
      parseDraftResolutionSources("https://example.com/a, CNN / BBC"),
    ).toEqual(["https://example.com/a", "CNN", "BBC"]);
  });

  it("trims entries and drops empties", () => {
    expect(parseDraftResolutionSources("  Reuters  ,, \n , AP News ")).toEqual([
      "Reuters",
      "AP News",
    ]);
    expect(parseDraftResolutionSources("")).toEqual([]);
    expect(parseDraftResolutionSources(" \n , ")).toEqual([]);
  });
});

describe("buildDraftMetadata", () => {
  it("includes trimmed optional fields when present", () => {
    const draft = makeDraft({
      outcomeNo: "  Stays under  ",
      outcomeYes: "Closes above",
      question: "  Will bitcoin close above $100k on 2027-01-01?  ",
      resolutionSources: "https://www.coingecko.com\nCNN / BBC",
      resolutionUrl: "  https://www.coingecko.com  ",
    });
    const { metadata, metadataHash, metadataPayload } =
      buildDraftMetadata(draft);

    expect(metadata).toEqual({
      category: "Crypto",
      createdAt: "2026-07-01T00:00:00.000Z",
      description: "A market about the bitcoin price.",
      outcomeNo: "Stays under",
      outcomeYes: "Closes above",
      question: "Will bitcoin close above $100k on 2027-01-01?",
      resolutionCriteria: draft.resolutionCriteria,
      resolutionSources: ["https://www.coingecko.com", "CNN", "BBC"],
      resolutionUrl: "https://www.coingecko.com",
      version: 1,
    });
    expect(metadataHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(JSON.parse(metadataPayload)).toEqual(metadata);
  });

  it("omits outcomes, sources, and url entirely when empty", () => {
    const { metadata } = buildDraftMetadata(makeDraft());

    expect("outcomeYes" in metadata).toBe(false);
    expect("outcomeNo" in metadata).toBe(false);
    expect("resolutionSources" in metadata).toBe(false);
    expect("resolutionUrl" in metadata).toBe(false);
  });

  it("falls back to the resolution url for sources when the field is empty", () => {
    const { metadata } = buildDraftMetadata(
      makeDraft({
        resolutionSources: "",
        resolutionUrl: "https://example.com/oracle",
      }),
    );

    expect(metadata.resolutionSources).toEqual(["https://example.com/oracle"]);
    expect(metadata.resolutionUrl).toBe("https://example.com/oracle");
  });

  it("hashes deterministically and moves with the content", () => {
    const draft = makeDraft();
    const first = buildDraftMetadata(draft);
    const second = buildDraftMetadata(makeDraft());
    const changed = buildDraftMetadata(
      makeDraft({ question: "Will ethereum close above $10k on 2027-01-01?" }),
    );

    expect(second.metadataHash).toBe(first.metadataHash);
    expect(changed.metadataHash).not.toBe(first.metadataHash);
  });
});

describe("buildDraftReviewMetadata", () => {
  const HASH = `0x${"ab".repeat(32)}`;

  it("carries the snapshot hash and spreads optional fields when present", () => {
    const draft = makeDraft({
      resolutionSources: "https://www.coingecko.com",
      resolutionUrl: "https://www.coingecko.com/btc",
    });

    expect(buildDraftReviewMetadata(draft, HASH)).toEqual({
      category: "Crypto",
      createdAt: "2026-07-01T00:00:00.000Z",
      description: "A market about the bitcoin price.",
      metadataHash: HASH,
      question: draft.question,
      resolutionCriteria: draft.resolutionCriteria,
      resolutionSources: ["https://www.coingecko.com"],
      resolutionUrl: "https://www.coingecko.com/btc",
    });
  });

  it("omits sources and url keys when the draft has neither", () => {
    const review = buildDraftReviewMetadata(makeDraft(), HASH);

    expect("resolutionSources" in review).toBe(false);
    expect("resolutionUrl" in review).toBe(false);
  });
});
