import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProtocolCreateMarketParams } from "@/domain/market-creation/types";
import { serializeProtocolCreateMarketParams } from "@/integrations/contracts/protocol-params";

import { POST } from "./route";

const METADATA_HASH = `0x${"ab".repeat(32)}` as const;

const protocolParams: ProtocolCreateMarketParams = {
  bypassAiResolution: false,
  collateral: "0x1111111111111111111111111111111111111111",
  graduationDeadline: 1_785_542_400n,
  graduationThreshold: 100_000_000_000_000_000_000n,
  liquidityParameter: 5_000_000_000_000_000_000_000n,
  metadata: '{"version":1}',
  metadataHash: METADATA_HASH,
  openingProbabilityWad: 500_000_000_000_000_000n,
  resolutionTime: 1_785_628_800n,
  yesNotBefore: 1_785_628_800n,
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/market-review/submissions", () => {
  describe("request validation", () => {
    it("rejects non-object bodies", async () => {
      const response = await POST(jsonRequest(null));

      await expectError(response, 400, "Request body must be an object.");
    });

    it("rejects invalid JSON with the parse error", async () => {
      const response = await POST(
        new Request("http://localhost/api/market-review/submissions", {
          body: "{not json",
          headers: { "content-type": "application/json" },
          method: "POST",
        })
      );

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toBeTruthy();
    });

    it("rejects unsupported collateral symbols", async () => {
      const response = await POST(
        jsonRequest(submission({ collateralSymbol: "USDC" }))
      );

      await expectError(response, 400, "collateralSymbol must be pUSD.");
    });

    it.each([0, -5, Number.POSITIVE_INFINITY, Number.NaN, "100"])(
      "rejects graduationThreshold %s",
      async (graduationThreshold) => {
        const response = await POST(jsonRequest(submission({ graduationThreshold })));

        await expectError(
          response,
          400,
          "graduationThreshold must be a positive number."
        );
      }
    );

    it("rejects malformed metadata hashes", async () => {
      const response = await POST(jsonRequest(submission({ metadataHash: "0x1234" })));

      await expectError(response, 400, "metadataHash must be a bytes32 hex string.");
    });

    it("surfaces protocol param parse failures", async () => {
      const response = await POST(
        jsonRequest(
          submission({
            protocolParams: { ...serializedParams(), collateral: "nope" },
          })
        )
      );

      await expectError(response, 400, "Invalid collateral.");
    });

    it("rejects a metadata hash that disagrees with the protocol params", async () => {
      const response = await POST(
        jsonRequest(submission({ metadataHash: `0x${"cd".repeat(32)}` }))
      );

      await expectError(
        response,
        400,
        "metadataHash must match protocolParams.metadataHash."
      );
    });

    it("accepts hash comparison case-insensitively", async () => {
      const response = await POST(
        jsonRequest(
          submission({ metadataHash: METADATA_HASH.toUpperCase().replace("0X", "0x") })
        )
      );

      expect(response.status).toBe(202);
    });

    it("rejects non-object metadata", async () => {
      const response = await POST(jsonRequest(submission({ metadata: "metadata" })));

      await expectError(response, 400, "metadata must be an object.");
    });

    it.each([
      [{ version: 2 }, "metadata.version must be 1."],
      [{ question: "   " }, "metadata.question is required."],
      [{ question: undefined }, "metadata.question is required."],
      [{ description: undefined }, "metadata.description is required."],
      [{ resolutionCriteria: 42 }, "metadata.resolutionCriteria is required."],
      [{ createdAt: undefined }, "metadata.createdAt is required."],
      [{ category: "Gossip" }, "metadata.category is not supported."],
      [{ resolutionUrl: 42 }, "metadata.resolutionUrl must be a string."],
      [
        { resolutionSources: ["ok", 42] },
        "metadata.resolutionSources must be an array of strings.",
      ],
      [
        { resolutionSources: "https://example.com" },
        "metadata.resolutionSources must be an array of strings.",
      ],
    ] as const)("rejects metadata override %j", async (override, error) => {
      const response = await POST(
        jsonRequest(submission({ metadata: { ...metadata(), ...override } }))
      );

      await expectError(response, 400, error);
    });
  });

  describe("without a review webhook", () => {
    it("queues the submission locally", async () => {
      const response = await POST(jsonRequest(submission()));
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(202);
      expect(body.status).toBe("queued");
      expect(body.aiReview).toEqual({ source: "local", status: "eligible" });
      expect(body.reviewId).toMatch(/^review-abababab-[0-9a-z]+$/);
      expect(typeof body.submittedAt).toBe("string");
    });
  });

  describe("with a review webhook", () => {
    it("forwards the submission and reports it", async () => {
      vi.stubEnv(
        "POPCHARTS_MARKET_REVIEW_WEBHOOK_URL",
        "https://reviews.example.com/hooks/markets"
      );
      const fetcher = stubWebhook(new Response(null, { status: 204 }));

      const response = await POST(jsonRequest(submission()));
      const body = (await response.json()) as Record<string, unknown>;

      expect(response.status).toBe(202);
      expect(body.aiReview).toEqual({ source: "webhook", status: "forwarded" });

      const [url, init] = webhookCall(fetcher);
      const forwarded = JSON.parse(String(init?.body)) as Record<string, unknown>;

      expect(String(url)).toBe("https://reviews.example.com/hooks/markets");
      expect(forwarded.reviewId).toBe(body.reviewId);
      expect(forwarded.status).toBe("queued");
      expect(forwarded.submission).toMatchObject({ metadataHash: METADATA_HASH });
    });

    it("reports generic copy when the webhook fails with a non-Error value", async () => {
      vi.stubEnv(
        "POPCHARTS_MARKET_REVIEW_WEBHOOK_URL",
        "https://reviews.example.com/hooks/markets"
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw "socket hangup";
        })
      );

      const response = await POST(jsonRequest(submission()));

      await expectError(response, 400, "Could not submit market for review.");
    });

    it("fails the submission when the webhook rejects it", async () => {
      vi.stubEnv(
        "POPCHARTS_MARKET_REVIEW_WEBHOOK_URL",
        "https://reviews.example.com/hooks/markets"
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 503 }))
      );

      const response = await POST(jsonRequest(submission()));

      await expectError(response, 400, "Could not submit market for review.");
    });

    it("hides a raw webhook URL config error behind generic copy", async () => {
      vi.stubEnv("POPCHARTS_MARKET_REVIEW_WEBHOOK_URL", "not a url");

      const response = await POST(jsonRequest(submission()));

      await expectError(response, 400, "Could not submit market for review.");
    });

    it("hides a non-HTTP webhook protocol config error behind generic copy", async () => {
      vi.stubEnv("POPCHARTS_MARKET_REVIEW_WEBHOOK_URL", "ftp://reviews.example.com");

      const response = await POST(jsonRequest(submission()));

      await expectError(response, 400, "Could not submit market for review.");
    });
  });

  describe("metadata normalization", () => {
    it("keeps optional fields that carry values", async () => {
      vi.stubEnv("POPCHARTS_MARKET_REVIEW_WEBHOOK_URL", "https://reviews.example.com");
      const fetcher = stubWebhook(new Response(null, { status: 200 }));

      await POST(
        jsonRequest(
          submission({
            metadata: {
              ...metadata(),
              resolutionSources: ["https://example.com/data"],
              resolutionUrl: "https://example.com",
            },
          })
        )
      );

      const [, init] = webhookCall(fetcher);
      const forwarded = JSON.parse(String(init?.body)) as {
        submission: { metadata: Record<string, unknown> };
      };

      expect(forwarded.submission.metadata.resolutionSources).toEqual([
        "https://example.com/data",
      ]);
      expect(forwarded.submission.metadata.resolutionUrl).toBe("https://example.com");
    });

    it("drops empty optional fields", async () => {
      vi.stubEnv("POPCHARTS_MARKET_REVIEW_WEBHOOK_URL", "https://reviews.example.com");
      const fetcher = stubWebhook(new Response(null, { status: 200 }));

      await POST(
        jsonRequest(
          submission({
            metadata: { ...metadata(), resolutionSources: [], resolutionUrl: "" },
          })
        )
      );

      const [, init] = webhookCall(fetcher);
      const forwarded = JSON.parse(String(init?.body)) as {
        submission: { metadata: Record<string, unknown> };
      };

      expect(forwarded.submission.metadata).not.toHaveProperty("resolutionSources");
      expect(forwarded.submission.metadata).not.toHaveProperty("resolutionUrl");
    });
  });
});

function metadata() {
  return {
    category: "Crypto",
    createdAt: "2026-07-06T12:00:00.000Z",
    description: "A market about the review pipeline.",
    question: "Will the review queue accept this market?",
    resolutionCriteria: "Resolves YES when accepted.",
    version: 1,
  };
}

function stubWebhook(response: Response) {
  const fetcher = vi.fn<(...args: Parameters<typeof fetch>) => Promise<Response>>(
    async () => response.clone()
  );
  vi.stubGlobal("fetch", fetcher);

  return fetcher;
}

function webhookCall(fetcher: ReturnType<typeof stubWebhook>) {
  const call = fetcher.mock.calls[0];

  if (!call) {
    throw new Error("Expected the webhook to be called.");
  }

  return call;
}

function serializedParams() {
  return serializeProtocolCreateMarketParams(protocolParams);
}

function submission(overrides: Record<string, unknown> = {}) {
  return {
    collateralSymbol: "pUSD",
    graduationThreshold: 100,
    metadata: metadata(),
    metadataHash: METADATA_HASH,
    protocolParams: serializedParams(),
    ...overrides,
  };
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/market-review/submissions", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function expectError(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(((await response.json()) as { error: string }).error).toBe(error);
}
