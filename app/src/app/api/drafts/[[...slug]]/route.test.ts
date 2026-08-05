import { afterEach, describe, expect, it, vi } from "vitest";

import { DRAFT_OWNER_HEADER } from "@/integrations/indexer/drafts-api";

import { DELETE, GET, PATCH, POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("/api/drafts proxy", () => {
  it("fails with 500 when no indexer API is configured", async () => {
    const response = await GET(draftsRequest("/api/drafts"), context([]));

    expect(response.status).toBe(500);
    expect(((await response.json()) as { error: string }).error).toBe(
      "POPCHARTS_INDEXER_API_URL is required to work with drafts."
    );
  });

  it("forwards a list read with the owner header and relays the body", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
    const fetcher = stubUpstream(
      new Response(JSON.stringify([{ id: 1 }]), {
        headers: { "content-type": "application/json" },
        status: 200,
      })
    );

    const response = await GET(draftsRequest("/api/drafts"), context([]));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: 1 }]);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe("http://indexer:3011/drafts");

    const init = fetcher.mock.calls[0]?.[1] as RequestInit;

    expect(new Headers(init.headers).get(DRAFT_OWNER_HEADER)).toBe("0xowner");
    expect(init.method).toBe("GET");
  });

  it("forwards path segments, query strings, and JSON bodies on writes", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011/");
    const fetcher = stubUpstream(
      new Response(JSON.stringify({ id: 2 }), { status: 201 })
    );

    const response = await POST(
      draftsRequest("/api/drafts/2/submit?force=1", {
        body: JSON.stringify({ question: "Will it?" }),
        method: "POST",
      }),
      context(["2", "submit"])
    );

    expect(response.status).toBe(201);
    expect(String(fetcher.mock.calls[0]?.[0])).toBe(
      "http://indexer:3011/drafts/2/submit?force=1"
    );

    const init = fetcher.mock.calls[0]?.[1] as RequestInit;

    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ question: "Will it?" }));
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
  });

  it("relays upstream error statuses and bodies untouched", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
    stubUpstream(new Response("Draft not found.", { status: 404 }));

    const response = await PATCH(
      draftsRequest("/api/drafts/9", {
        body: JSON.stringify({ question: "Edited" }),
        method: "PATCH",
      }),
      context(["9"])
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Draft not found.");
  });

  it("omits the owner header when the caller sent none", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
    const fetcher = stubUpstream(new Response("Unauthorized.", { status: 401 }));

    await DELETE(
      new Request("http://app.local/api/drafts/3", { method: "DELETE" }),
      context(["3"])
    );

    const init = fetcher.mock.calls[0]?.[1] as RequestInit;

    expect(new Headers(init.headers).get(DRAFT_OWNER_HEADER)).toBeNull();
    expect(init.method).toBe("DELETE");
  });

  it("answers 502 when the draft service is unreachable", async () => {
    vi.stubEnv("POPCHARTS_INDEXER_API_URL", "http://indexer:3011");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      })
    );

    const response = await POST(
      draftsRequest("/api/drafts", { body: "{}", method: "POST" }),
      context([])
    );

    expect(response.status).toBe(502);
    expect(((await response.json()) as { error: string }).error).toBe(
      "The draft service is unreachable."
    );
  });
});

function draftsRequest(path: string, init: RequestInit = {}) {
  return new Request(`http://app.local${path}`, {
    headers: {
      "content-type": "application/json",
      [DRAFT_OWNER_HEADER]: "0xowner",
      ...(init.headers ?? {}),
    },
    ...init,
  });
}

function context(slug: string[]) {
  return { params: Promise.resolve(slug.length > 0 ? { slug } : {}) };
}

function stubUpstream(response: Response) {
  const fetcher = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(
    async () => response
  );
  vi.stubGlobal("fetch", fetcher);

  return fetcher;
}
