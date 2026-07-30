import { describe, expect, it } from "vitest";

import {
  createInitialMarketDraft,
  dateTimeLocalToDate,
} from "@/domain/market-creation/create-market";
import type { GeneratedLocalMarket } from "@/integrations/local-market-generator/types";

import { applyGeneratedMarketToDraft } from "./dev-autofill";

const INITIAL_NOW = "2030-06-01T09:00:00.000Z";

describe("applyGeneratedMarketToDraft", () => {
  it("fills the form from the generated market", () => {
    const market = weatherMarket();

    const draft = applyGeneratedMarketToDraft(baseDraft(), market);

    expect(draft.question).toBe(market.metadata.question);
    expect(draft.category).toBe("Weather");
    expect(draft.description).toBe(market.metadata.description);
    expect(draft.resolutionCriteria).toBe(market.metadata.resolutionCriteria);
    expect(draft.resolutionSources).toBe(
      "https://example.test/forecast\nhttps://example.test/metar"
    );
    expect(draft.resolutionUrl).toBe("https://example.test/metar");
    // Carried over, because the generated question quotes a time derived from it.
    expect(draft.createdAt).toBe(market.metadata.createdAt);
  });

  it("sets both deadlines to the generated instants as custom windows", () => {
    const draft = applyGeneratedMarketToDraft(baseDraft(), weatherMarket());

    expect(draft.graduationPreset).toBe("custom");
    expect(draft.resolutionPreset).toBe("custom");
    expect(dateTimeLocalToDate(draft.graduationTime)?.toISOString()).toBe(
      "2030-07-01T13:00:00.000Z"
    );
    expect(dateTimeLocalToDate(draft.resolutionTime)?.toISOString()).toBe(
      "2030-07-01T14:00:00.000Z"
    );
  });

  it("leaves the fields the generator has no opinion about alone", () => {
    const before = baseDraft();

    const draft = applyGeneratedMarketToDraft(
      { ...before, liquidityParameter: 2_000, openingProbability: 61 },
      weatherMarket()
    );

    expect(draft.liquidityParameter).toBe(2_000);
    expect(draft.openingProbability).toBe(61);
  });

  it("clears outcome labels and sources a generated market does not carry", () => {
    const market = weatherMarket();

    const draft = applyGeneratedMarketToDraft(
      { ...baseDraft(), outcomeNo: "Away", outcomeYes: "Home" },
      {
        ...market,
        metadata: {
          category: market.metadata.category,
          createdAt: market.metadata.createdAt,
          description: market.metadata.description,
          question: market.metadata.question,
          resolutionCriteria: market.metadata.resolutionCriteria,
          version: 1,
        },
      }
    );

    expect(draft.outcomeNo).toBe("");
    expect(draft.outcomeYes).toBe("");
    expect(draft.resolutionSources).toBe("");
    expect(draft.resolutionUrl).toBe("");
  });

  it("keeps the current category when the generated one is not offered", () => {
    const market = weatherMarket();

    const draft = applyGeneratedMarketToDraft(
      { ...baseDraft(), category: "Sports" },
      { ...market, metadata: { ...market.metadata, category: "Astronomy" } }
    );

    expect(draft.category).toBe("Sports");
  });
});

function baseDraft() {
  return createInitialMarketDraft(new Date(INITIAL_NOW));
}

function weatherMarket(): GeneratedLocalMarket {
  return {
    graduationAt: "2030-07-01T13:00:00.000Z",
    metadata: {
      category: "Weather",
      createdAt: "2030-07-01T12:00:00.000Z",
      description: "Auto-generated local-dev market.",
      question: "Will the max NYC METAR temperature be higher than 80°F?",
      resolutionCriteria: "Resolve YES if the max observation is higher.",
      resolutionSources: [
        "https://example.test/forecast",
        "https://example.test/metar",
      ],
      resolutionUrl: "https://example.test/metar",
      version: 1,
    },
    resolutionAt: "2030-07-01T14:00:00.000Z",
  };
}
