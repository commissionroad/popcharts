import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GeneratedLocalMarket } from "@/integrations/local-market-generator/types";

import { fetchGeneratedLocalMarket } from "./generated-market-service";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchGeneratedLocalMarket", () => {
  it("returns the generated market the dev route produced", async () => {
    stubResponse({ body: weatherMarket(), ok: true });

    await expect(fetchGeneratedLocalMarket()).resolves.toEqual(weatherMarket());
  });

  it("surfaces the route's own refusal verbatim", async () => {
    stubResponse({ body: { error: "Local dev tools are not enabled." }, ok: false });

    await expect(fetchGeneratedLocalMarket()).rejects.toThrow(
      "Local dev tools are not enabled."
    );
  });

  it("falls back to its own copy when a failure carries no message", async () => {
    stubResponse({ body: null, ok: false });

    await expect(fetchGeneratedLocalMarket()).rejects.toThrow(
      "The market generator could not be reached."
    );
  });

  it("rejects a body that is not a market at all", async () => {
    stubResponse({ body: "not a market", ok: true });

    await expect(fetchGeneratedLocalMarket()).rejects.toThrow(
      "returned a malformed market"
    );
  });

  it("rejects a market whose deadline is not a usable instant", async () => {
    stubResponse({ body: { ...weatherMarket(), resolutionAt: "soon" }, ok: true });

    await expect(fetchGeneratedLocalMarket()).rejects.toThrow("no usable resolutionAt");
  });

  it("rejects metadata the create form could not serialize", async () => {
    stubResponse({ body: { ...weatherMarket(), metadata: { version: 2 } }, ok: true });

    await expect(fetchGeneratedLocalMarket()).rejects.toThrow(
      "Market metadata version must be 1."
    );
  });
});

function weatherMarket(): GeneratedLocalMarket {
  return {
    graduationAt: "2030-07-01T13:00:00.000Z",
    metadata: {
      category: "Weather",
      createdAt: "2030-07-01T12:00:00.000Z",
      description: "Auto-generated local-dev market.",
      question: "Will the max NYC METAR temperature be higher than 80°F?",
      resolutionCriteria: "Resolve YES if the max observation is higher.",
      resolutionSources: ["https://example.test/forecast"],
      resolutionUrl: "https://example.test/metar",
      version: 1,
    },
    resolutionAt: "2030-07-01T14:00:00.000Z",
  };
}

function stubResponse({ body, ok }: { body: unknown; ok: boolean }) {
  vi.mocked(fetch).mockResolvedValue({
    json: async () => {
      if (body === null) {
        throw new Error("Unexpected end of JSON input");
      }

      return body;
    },
    ok,
  } as Response);
}
