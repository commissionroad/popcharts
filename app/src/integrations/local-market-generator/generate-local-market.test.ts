import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildGeneratedMarket } from "../../../../scripts/shared/localMarket/generatedMarketPlan.ts";
import { readExistingGeneratedMarketOptions } from "../../../../scripts/shared/localMarket/indexedMarketOptions.ts";
import { generateLocalMarket } from "./generate-local-market";

vi.mock("../../../../scripts/shared/localMarket/generatedMarketPlan.ts", () => ({
  buildGeneratedMarket: vi.fn(),
}));

vi.mock("../../../../scripts/shared/localMarket/indexedMarketOptions.ts", () => ({
  readExistingGeneratedMarketOptions: vi.fn(),
}));

const CREATED_AT = "2030-07-01T12:00:00.000Z";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(buildGeneratedMarket).mockResolvedValue(generatedMarket());
  vi.mocked(readExistingGeneratedMarketOptions).mockResolvedValue(
    new Set(["crypto:bitcoin:higher"])
  );
});

describe("generateLocalMarket", () => {
  it("anchors both deadlines to the metadata's own creation time", async () => {
    const market = await generateLocalMarket({
      chainId: 31337,
      indexerApiBaseUrl: undefined,
      logLabel: "test",
    });

    expect(market.metadata.question).toContain("BTC/USD");
    // createdAt + 1h and createdAt + 2h, not "an hour from whenever this ran":
    // the question text quotes its own resolution time.
    expect(market.graduationAt).toBe("2030-07-01T13:00:00.000Z");
    expect(market.resolutionAt).toBe("2030-07-01T14:00:00.000Z");
  });

  it("never asks for an incoherent market", async () => {
    await generateLocalMarket({
      chainId: 31337,
      indexerApiBaseUrl: undefined,
      logLabel: "test",
    });

    expect(vi.mocked(buildGeneratedMarket).mock.calls[0]?.[0]).toMatchObject({
      kind: "random",
      rejectable: "never",
    });
  });

  it("prefers options no existing market has used when an indexer is configured", async () => {
    await generateLocalMarket({
      chainId: 31337,
      indexerApiBaseUrl: "http://127.0.0.1:3001",
      logLabel: "test",
    });

    expect(readExistingGeneratedMarketOptions).toHaveBeenCalledWith({
      apiBaseUrl: "http://127.0.0.1:3001",
      chainId: 31337,
      logLabel: "test",
    });
    expect(vi.mocked(buildGeneratedMarket).mock.calls[0]?.[0].usedOptionKeys).toEqual(
      new Set(["crypto:bitcoin:higher"])
    );
  });

  it("generates without an indexer rather than failing", async () => {
    const market = await generateLocalMarket({
      chainId: 31337,
      indexerApiBaseUrl: undefined,
      logLabel: "test",
    });

    expect(readExistingGeneratedMarketOptions).not.toHaveBeenCalled();
    expect(vi.mocked(buildGeneratedMarket).mock.calls[0]?.[0].usedOptionKeys).toEqual(
      new Set()
    );
    expect(market.metadata.category).toBe("Crypto");
  });
});

function generatedMarket() {
  return {
    graduationSeconds: 60 * 60,
    kind: "crypto" as const,
    metadata: {
      category: "Crypto",
      createdAt: CREATED_AT,
      description: "Auto-generated local-dev market.",
      question: "Will BTC/USD be higher than $60,000 at 2030-07-01T14:00:00Z?",
      resolutionCriteria: "Resolve YES if the source reports higher.",
      resolutionUrl: "https://example.test/price",
      version: 1 as const,
    },
    resolutionSeconds: 2 * 60 * 60,
  };
}
