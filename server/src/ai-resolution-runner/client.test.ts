import { describe, expect, it } from "bun:test";

import type { MarketResolutionRequest } from "src/ai-resolution/types";

import { AiResolutionServiceError, resolveMarketWithService } from "./client";

const config = { requestTimeoutMs: 1_000, serviceUrl: "http://svc" };
const request: MarketResolutionRequest = {
  metadata: { question: "?", resolutionCriteria: "criteria" },
};

describe("resolveMarketWithService", () => {
  it("posts to /resolutions/market and returns the result", async () => {
    let capturedUrl = "";
    const result = { verdict: "manual_review" };
    const fetchImpl = (async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return {
        json: async () => result,
        ok: true,
        status: 200,
      } as Response;
    }) as typeof fetch;

    const out = await resolveMarketWithService({ config, fetchImpl, request });

    expect(capturedUrl).toBe("http://svc/resolutions/market");
    expect(out).toEqual(result as never);
  });

  it("throws AiResolutionServiceError with the status on a non-ok response", async () => {
    const fetchImpl = (async () =>
      ({
        json: async () => ({}),
        ok: false,
        status: 503,
      }) as Response) as unknown as typeof fetch;

    try {
      await resolveMarketWithService({ config, fetchImpl, request });
      throw new Error("expected resolveMarketWithService to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AiResolutionServiceError);
      expect((error as AiResolutionServiceError).status).toBe(503);
    }
  });

  it("normalizes a transport failure", async () => {
    const fetchImpl = (async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;

    await expect(
      resolveMarketWithService({ config, fetchImpl, request }),
    ).rejects.toThrow("request failed: boom");
  });
});
