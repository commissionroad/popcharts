import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createDraftsApiClient,
  DRAFT_OWNER_HEADER,
  DraftsApiError,
} from "@/integrations/indexer/drafts-api";
import { marketDraftFactory } from "@/test/factories/drafts";

const OWNER = "0x90f79bf6eb2c4f870365e785982e1f101e93b906";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createDraftsApiClient requests", () => {
  it("lists drafts through the api proxy with the owner header", async () => {
    const fetcher = stubFetch(jsonResponse([marketDraftFactory()], 200));

    const drafts = await client().list();

    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.id).toBe(12);
    const [url, init] = lastCall(fetcher);
    expect(url).toBe("/api/drafts");
    expect(init?.method).toBeUndefined();
    expect(init?.cache).toBe("no-store");
    expect(init?.headers).toEqual({
      accept: "application/json",
      [DRAFT_OWNER_HEADER]: OWNER,
    });
  });

  it("creates a draft with a JSON body and content type", async () => {
    const fetcher = stubFetch(jsonResponse(marketDraftFactory({ id: 3 }), 201));

    const draft = await client().create({ question: "Will it save?" });

    expect(draft.id).toBe(3);
    const [url, init] = lastCall(fetcher);
    expect(url).toBe("/api/drafts");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toEqual({
      accept: "application/json",
      [DRAFT_OWNER_HEADER]: OWNER,
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toEqual({ question: "Will it save?" });
  });

  it("reads a wallet's review credit with the address in the query", async () => {
    const position = {
      availableWad: "900000000000000000",
      metered: true,
      rateWad: "100000000000000000",
      runsRemaining: 9,
      runsUsed: 1,
    };
    const fetcher = stubFetch(jsonResponse(position, 200));

    const credit = await client().credit(OWNER);

    expect(credit).toEqual(position);
    expect(lastCall(fetcher)[0]).toBe(`/api/drafts/credit?address=${OWNER}`);
  });

  it("reads one draft by id", async () => {
    const fetcher = stubFetch(jsonResponse(marketDraftFactory({ id: 8 }), 200));

    const draft = await client().get(8);

    expect(draft?.id).toBe(8);
    expect(lastCall(fetcher)[0]).toBe("/api/drafts/8");
  });

  it("returns null when the draft does not exist", async () => {
    stubFetch(jsonResponse("Draft not found.", 404));

    await expect(client().get(404)).resolves.toBeNull();
  });

  it("rethrows non-404 failures from get", async () => {
    stubFetch(jsonResponse("Sign in to manage drafts.", 401));

    await expect(client().get(8)).rejects.toThrow("Sign in to manage drafts.");
  });

  it("updates a draft with PATCH", async () => {
    const fetcher = stubFetch(jsonResponse(marketDraftFactory({ id: 8 }), 200));

    await client().update(8, { question: "Edited?" });

    const [url, init] = lastCall(fetcher);
    expect(url).toBe("/api/drafts/8");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ question: "Edited?" });
  });

  it("removes a draft with DELETE and resolves to nothing", async () => {
    const fetcher = stubFetch(jsonResponse("Draft deleted.", 200));

    await expect(client().remove(8)).resolves.toBeUndefined();

    const [url, init] = lastCall(fetcher);
    expect(url).toBe("/api/drafts/8");
    expect(init?.method).toBe("DELETE");
  });

  it("clones from a draft or market", async () => {
    const fetcher = stubFetch(jsonResponse(marketDraftFactory({ id: 9 }), 201));

    const draft = await client().clone({ asTemplate: true, fromDraftId: 8 });

    expect(draft.id).toBe(9);
    const [url, init] = lastCall(fetcher);
    expect(url).toBe("/api/drafts/clone");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      asTemplate: true,
      fromDraftId: 8,
    });
  });

  it("submits a draft for review", async () => {
    const fetcher = stubFetch(
      jsonResponse(marketDraftFactory({ id: 8, status: "in_review" }), 202)
    );

    const draft = await client().submit(8);

    expect(draft.status).toBe("in_review");
    const [url, init] = lastCall(fetcher);
    expect(url).toBe("/api/drafts/8/submit");
    expect(init?.method).toBe("POST");
  });

  it("mints publish params for an approved draft", async () => {
    const fetcher = stubFetch(
      jsonResponse({ metadataHash: `0x${"ab".repeat(32)}` }, 200)
    );

    const params = await client().publishParams(8);

    expect(params.metadataHash).toBe(`0x${"ab".repeat(32)}`);
    const [url, init] = lastCall(fetcher);
    expect(url).toBe("/api/drafts/8/publish-params");
    expect(init?.method).toBe("POST");
  });

  it("binds the publishing wallet into the publish-params query", async () => {
    const fetcher = stubFetch(
      jsonResponse({ metadataHash: `0x${"ab".repeat(32)}` }, 200)
    );

    await client().publishParams(8, "0x1111111111111111111111111111111111111111");

    const [url] = lastCall(fetcher);
    expect(url).toBe(
      "/api/drafts/8/publish-params?creatorAddress=0x1111111111111111111111111111111111111111"
    );
  });

  it("records a confirmed publish transaction", async () => {
    const fetcher = stubFetch(
      jsonResponse(
        { bridgeApproved: true, draft: marketDraftFactory({ status: "published" }) },
        200
      )
    );

    const published = await client().markPublished(8, {
      chainId: 31337,
      marketId: "9",
      transactionHash: `0x${"cc".repeat(32)}`,
    });

    expect(published.bridgeApproved).toBe(true);
    const [url, init] = lastCall(fetcher);
    expect(url).toBe("/api/drafts/8/published");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      chainId: 31337,
      marketId: "9",
      transactionHash: `0x${"cc".repeat(32)}`,
    });
  });

  it("honors a custom base path", async () => {
    const fetcher = stubFetch(jsonResponse([], 200));

    await createDraftsApiClient({ basePath: "", getAuthHeaders: devHeaders }).list();

    expect(lastCall(fetcher)[0]).toBe("/drafts");
  });
});

describe("createDraftsApiClient failures", () => {
  it("carries validation messages and string field errors", async () => {
    stubFetch(
      jsonResponse(
        {
          errors: { question: "Add a market question.", liquidityParameter: 42 },
          message: "Fix the highlighted fields before submitting.",
        },
        422
      )
    );

    const error = await captureError(client().submit(8));

    expect(error).toBeInstanceOf(DraftsApiError);
    expect(error.name).toBe("DraftsApiError");
    expect(error.message).toBe("Fix the highlighted fields before submitting.");
    expect(error.status).toBe(422);
    expect(error.fieldErrors).toEqual({ question: "Add a market question." });
  });

  it("carries the credit shortfall from a 402 meter refusal", async () => {
    const shortfall = {
      availableWad: "0",
      message: "You're out of review credit.",
      requiredWad: "100000000000000000",
      runsUsed: 3,
    };
    stubFetch(jsonResponse(shortfall, 402));

    const error = await captureError(client().submit(8));

    expect(error).toBeInstanceOf(DraftsApiError);
    expect(error.message).toBe("You're out of review credit.");
    expect(error.status).toBe(402);
    expect(error.bondShortfall).toEqual(shortfall);
    expect(error.fieldErrors).toBeUndefined();
  });

  it("does not invent a shortfall for a plain 402 message", async () => {
    stubFetch(jsonResponse("Payment required.", 402));

    const error = await captureError(client().submit(8));

    expect(error.message).toBe("Payment required.");
    expect(error.status).toBe(402);
    expect(error.bondShortfall).toBeUndefined();
  });

  it("uses a JSON string body as the message", async () => {
    stubFetch(jsonResponse("Draft is not approved.", 409));

    const error = await captureError(client().submit(8));

    expect(error.message).toBe("Draft is not approved.");
    expect(error.status).toBe(409);
    expect(error.fieldErrors).toBeUndefined();
  });

  it("uses a non-JSON text body as the message", async () => {
    stubFetch(new Response("gateway timeout", { status: 504 }));

    const error = await captureError(client().list());

    expect(error.message).toBe("gateway timeout");
    expect(error.status).toBe(504);
  });

  it("uses the error field of a JSON object body", async () => {
    stubFetch(jsonResponse({ error: "Drafts are disabled." }, 501));

    const error = await captureError(client().list());

    expect(error.message).toBe("Drafts are disabled.");
    expect(error.status).toBe(501);
  });

  it("falls back to generic copy for an empty body", async () => {
    stubFetch(new Response("", { status: 500 }));

    const error = await captureError(client().list());

    expect(error.message).toBe("Draft request failed (500).");
    expect(error.status).toBe(500);
  });

  it("falls back to generic copy for an object without a usable message", async () => {
    stubFetch(jsonResponse({ detail: "nope" }, 500));

    const error = await captureError(client().list());

    expect(error.message).toBe("Draft request failed (500).");
  });

  it("ignores validation shapes whose message is not a string", async () => {
    stubFetch(jsonResponse({ errors: {}, message: 42 }, 422));

    const error = await captureError(client().submit(8));

    expect(error.message).toBe("Draft request failed (422).");
  });

  it("ignores a non-string error field", async () => {
    stubFetch(jsonResponse({ error: 42 }, 502));

    const error = await captureError(client().list());

    expect(error.message).toBe("Draft request failed (502).");
  });
});

function client() {
  return createDraftsApiClient({ getAuthHeaders: devHeaders });
}

// Mirrors the local-dev identity the wallet provider produces.
async function devHeaders() {
  return { [DRAFT_OWNER_HEADER]: OWNER };
}

function stubFetch(response: Response) {
  const fetcher = vi.fn(async () => response);

  vi.stubGlobal("fetch", fetcher);

  return fetcher;
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function lastCall(fetcher: ReturnType<typeof vi.fn>) {
  const call = fetcher.mock.calls.at(-1) as Parameters<typeof fetch> | undefined;

  if (!call) {
    throw new Error("Expected fetch to be called.");
  }

  return call;
}

async function captureError(request: Promise<unknown>): Promise<DraftsApiError> {
  try {
    await request;
  } catch (error) {
    if (error instanceof DraftsApiError) {
      return error;
    }

    throw error;
  }

  throw new Error("Expected the request to reject.");
}
