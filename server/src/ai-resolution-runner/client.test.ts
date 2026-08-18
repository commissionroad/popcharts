import { describe, expect, it } from "bun:test";

import type { MarketResolutionRequest } from "src/ai-resolution/types";

import { AiResolutionServiceError, resolveMarketWithService } from "./client";

const config = { requestTimeoutMs: 1_000, serviceUrl: "http://svc" };
const request: MarketResolutionRequest = {
  metadata: { question: "?", resolutionCriteria: "criteria" },
};

/** A schema-valid parked result — the minimum the client will now accept. */
const parkedResult = {
  confidence: null,
  evidence: [],
  hardFlags: [],
  outcome: "abstain",
  promptVersion: "v1",
  provider: "ollama",
  reasons: [],
  sourceChecks: [],
  verdict: "manual_review",
};

/** A fetch stub that returns `body` with HTTP 200. */
function respondWith(body: unknown, capture?: (url: string) => void) {
  return (async (url: string | URL | Request) => {
    capture?.(String(url));
    return {
      json: async () => body,
      ok: true,
      status: 200,
    } as Response;
  }) as typeof fetch;
}

describe("resolveMarketWithService", () => {
  it("posts to /resolutions/market and returns the result", async () => {
    let capturedUrl = "";
    const fetchImpl = respondWith(parkedResult, (url) => {
      capturedUrl = url;
    });

    const out = await resolveMarketWithService({ config, fetchImpl, request });

    expect(capturedUrl).toBe("http://svc/resolutions/market");
    expect(out).toEqual(parkedResult as never);
  });

  // The cast this replaced accepted any of these bodies as a ResolutionResult.
  it("rejects a body that is not a resolution result", async () => {
    const fetchImpl = respondWith({ verdict: "manual_review" });

    await expect(
      resolveMarketWithService({ config, fetchImpl, request }),
    ).rejects.toBeInstanceOf(AiResolutionServiceError);
  });

  it("rejects an unknown verdict rather than passing it to the caller", async () => {
    const fetchImpl = respondWith({
      ...parkedResult,
      verdict: "resolve_everything",
    });

    await expect(
      resolveMarketWithService({ config, fetchImpl, request }),
    ).rejects.toThrow(/malformed result/);
  });

  it("rejects an HTML error page served with HTTP 200", async () => {
    const fetchImpl = respondWith("<!doctype html><title>502</title>");

    await expect(
      resolveMarketWithService({ config, fetchImpl, request }),
    ).rejects.toBeInstanceOf(AiResolutionServiceError);
  });

  it("names the offending field so an operator can see what was wrong", async () => {
    const fetchImpl = respondWith({ ...parkedResult, confidence: "high" });

    await expect(
      resolveMarketWithService({ config, fetchImpl, request }),
    ).rejects.toThrow(/confidence/);
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
