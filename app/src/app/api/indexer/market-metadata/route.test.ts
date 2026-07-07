import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const METADATA_HASH = `0x${"ab".repeat(32)}` as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/indexer/market-metadata", () => {
  it("fails with 500 when no indexer API is configured", async () => {
    const response = await POST(jsonRequest(proxyBody()));

    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toBe(
      "POPCHARTS_INDEXER_API_URL is required to sync market metadata."
    );
  });

  it("falls back to the public indexer URL variable", async () => {
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
    const fetcher = stubUpstream(new Response("{}", { status: 200 }));

    const response = await POST(jsonRequest(proxyBody()));

    expect(response.status).toBe(200);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "http://indexer:3011/markets/31337/metadata"
    );
  });

  it("builds the upstream URL from a base with a trailing slash", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011/");
    const fetcher = stubUpstream(new Response("{}", { status: 200 }));

    await POST(jsonRequest(proxyBody()));

    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "http://indexer:3011/markets/31337/metadata"
    );
  });

  describe("request validation", () => {
    it("rejects non-object bodies", async () => {
      vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");

      const response = await POST(jsonRequest(42));

      await expectError(response, "Request body must be an object.");
    });

    it.each([0, -1, 1.5, "31337", undefined])("rejects chainId %s", async (chainId) => {
      vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");

      const response = await POST(jsonRequest(proxyBody({ chainId })));

      await expectError(response, "chainId must be a positive integer.");
    });

    it("rejects malformed metadata hashes", async () => {
      vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");

      const response = await POST(jsonRequest(proxyBody({ metadataHash: "0xnope" })));

      await expectError(response, "metadataHash must be a bytes32 hex string.");
    });

    it.each([
      [{ version: "1" }, "metadata.version must be 1."],
      [{ question: "" }, "metadata.question is required."],
      [{ description: 42 }, "metadata.description is required."],
      [{ resolutionCriteria: undefined }, "metadata.resolutionCriteria is required."],
      [{ createdAt: 1234 }, "metadata.createdAt is required."],
      [{ category: "Rumors" }, "metadata.category is not supported."],
      [
        { resolutionUrl: ["https://example.com"] },
        "metadata.resolutionUrl must be a string.",
      ],
      [
        { resolutionSources: [42] },
        "metadata.resolutionSources must be an array of strings.",
      ],
    ] as const)("rejects metadata override %j", async (override, error) => {
      vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");

      const response = await POST(
        jsonRequest(proxyBody({ metadata: { ...metadata(), ...override } }))
      );

      await expectError(response, error);
    });

    it("rejects a non-object metadata value", async () => {
      vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");

      const response = await POST(jsonRequest(proxyBody({ metadata: null })));

      await expectError(response, "metadata must be an object.");
    });
  });

  describe("proxying", () => {
    it("passes the upstream status, content type, and body through", async () => {
      vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
      stubUpstream(
        new Response('{"saved":true}', {
          headers: { "content-type": "application/json" },
          status: 201,
        })
      );

      const response = await POST(jsonRequest(proxyBody()));

      expect(response.status).toBe(201);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(await response.text()).toBe('{"saved":true}');
    });

    it("passes upstream errors through without translation", async () => {
      vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
      stubUpstream(new Response('{"error":"duplicate metadata"}', { status: 409 }));

      const response = await POST(jsonRequest(proxyBody()));

      expect(response.status).toBe(409);
      expect(await response.text()).toBe('{"error":"duplicate metadata"}');
    });

    it("tolerates an upstream response without a content type", async () => {
      vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
      stubUpstream(new Response(null, { status: 200 }));

      const response = await POST(jsonRequest(proxyBody()));

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("");
    });

    it("reports upstream network failures", async () => {
      vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("Connection refused.");
        })
      );

      const response = await POST(jsonRequest(proxyBody()));

      await expectError(response, "Connection refused.");
    });

    it("reports generic copy for non-Error upstream failures", async () => {
      vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw "socket hangup";
        })
      );

      const response = await POST(jsonRequest(proxyBody()));

      await expectError(response, "Could not sync market metadata.");
    });

    it("forwards optional metadata fields only when they carry values", async () => {
      vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
      const fetcher = stubUpstream(new Response("{}", { status: 200 }));

      await POST(
        jsonRequest(
          proxyBody({
            metadata: {
              ...metadata(),
              resolutionSources: ["https://example.com/data"],
              resolutionUrl: "https://example.com",
            },
          })
        )
      );
      await POST(
        jsonRequest(proxyBody({ metadata: { ...metadata(), resolutionSources: [] } }))
      );

      const withOptional = upstreamBody(fetcher, 0);
      const withoutOptional = upstreamBody(fetcher, 1);

      expect(withOptional.resolutionSources).toEqual(["https://example.com/data"]);
      expect(withOptional.resolutionUrl).toBe("https://example.com");
      expect(withOptional.metadataHash).toBe(METADATA_HASH);
      expect(withoutOptional).not.toHaveProperty("resolutionSources");
      expect(withoutOptional).not.toHaveProperty("resolutionUrl");
    });

    it("forwards outcome labels only when they carry values", async () => {
      vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
      const fetcher = stubUpstream(new Response("{}", { status: 200 }));

      await POST(
        jsonRequest(
          proxyBody({
            metadata: { ...metadata(), outcomeNo: "Egypt", outcomeYes: "Argentina" },
          })
        )
      );
      await POST(jsonRequest(proxyBody()));

      const withLabels = upstreamBody(fetcher, 0);
      const withoutLabels = upstreamBody(fetcher, 1);

      expect(withLabels.outcomeYes).toBe("Argentina");
      expect(withLabels.outcomeNo).toBe("Egypt");
      expect(withoutLabels).not.toHaveProperty("outcomeYes");
      expect(withoutLabels).not.toHaveProperty("outcomeNo");
    });

    it("rejects blank outcome labels", async () => {
      vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
      stubUpstream(new Response("{}", { status: 200 }));

      const response = await POST(
        jsonRequest(proxyBody({ metadata: { ...metadata(), outcomeYes: "  " } }))
      );

      await expectError(response, "metadata.outcomeYes must be a non-empty string.");
    });
  });
});

function metadata() {
  return {
    category: "Crypto",
    createdAt: "2026-07-06T12:00:00.000Z",
    description: "A market about the indexer proxy.",
    question: "Will the metadata sync?",
    resolutionCriteria: "Resolves YES when synced.",
    version: 1,
  };
}

function proxyBody(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 31337,
    metadata: metadata(),
    metadataHash: METADATA_HASH,
    ...overrides,
  };
}

function stubUpstream(response: Response) {
  const fetcher = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
    async () => response.clone()
  );
  vi.stubGlobal("fetch", fetcher);

  return fetcher;
}

function upstreamBody(fetcher: ReturnType<typeof stubUpstream>, callIndex: number) {
  const call = fetcher.mock.calls[callIndex];

  if (!call) {
    throw new Error(`Expected upstream fetch call ${callIndex}.`);
  }

  return JSON.parse(String(call[1]?.body)) as Record<string, unknown>;
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/indexer/market-metadata", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function expectError(response: Response, error: string) {
  expect(response.status).toBe(400);
  expect(((await response.json()) as { error: string }).error).toBe(error);
}
