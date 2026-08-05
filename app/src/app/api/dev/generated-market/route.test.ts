import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateLocalMarket } from "@/integrations/local-market-generator/generate-local-market";

import { GET } from "./route";

const devToolsState = vi.hoisted(() => ({ enabled: true }));

vi.mock("@/features/dev-settings/dev-settings", () => ({
  devToolsEnabled: () => devToolsState.enabled,
}));

vi.mock("@/integrations/local-market-generator/generate-local-market", () => ({
  generateLocalMarket: vi.fn(),
}));

const generated = {
  graduationAt: "2030-07-01T13:00:00.000Z",
  metadata: {
    category: "Weather",
    createdAt: "2030-07-01T12:00:00.000Z",
    description: "Auto-generated local-dev market.",
    question: "Will the max NYC METAR temperature be higher than 80°F?",
    resolutionCriteria: "Resolve YES if the max observation is higher.",
    resolutionUrl: "https://example.test/metar",
    version: 1 as const,
  },
  resolutionAt: "2030-07-01T14:00:00.000Z",
};

beforeEach(() => {
  vi.clearAllMocks();
  devToolsState.enabled = true;
  vi.mocked(generateLocalMarket).mockResolvedValue(generated);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/dev/generated-market", () => {
  it("returns a generated market for the create form to fill from", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(generated);
  });

  it("passes the configured indexer through so generation avoids duplicates", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "  http://127.0.0.1:3001  ");

    await GET();

    expect(generateLocalMarket).toHaveBeenCalledWith(
      expect.objectContaining({ indexerApiBaseUrl: "http://127.0.0.1:3001" })
    );
  });

  it("generates without an indexer when none is configured", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "   ");

    await GET();

    expect(generateLocalMarket).toHaveBeenCalledWith(
      expect.objectContaining({ indexerApiBaseUrl: undefined })
    );
  });

  it("is not found when dev tools are off", async () => {
    devToolsState.enabled = false;

    const response = await GET();

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Local dev tools are not enabled.",
    });
  });

  it("is not found in a production build even with dev tools on", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await GET();

    expect(response.status).toBe(404);
    expect(generateLocalMarket).not.toHaveBeenCalled();
  });

  it("reports an unreachable source without leaking the raw failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(generateLocalMarket).mockRejectedValue(
      new Error("bitcoin: GET https://example.test returned 429.")
    );

    const response = await GET();
    const body = (await response.json()) as { error: string };

    expect(response.status).toBe(502);
    expect(body.error).toContain("No live source could be reached");
    expect(body.error).not.toContain("429");
  });
});
