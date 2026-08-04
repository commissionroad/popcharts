import { describe, expect, it } from "bun:test";

import { evidenceFromTavilyResponse } from "./tavily";

describe("evidenceFromTavilyResponse", () => {
  it("records the page text Tavily returns inline, with no fetch of our own", () => {
    const evidence = evidenceFromTavilyResponse({
      results: [
        {
          content: "The target range was left unchanged.",
          score: 0.98,
          title: "FOMC statement",
          url: "https://www.federalreserve.gov/news.htm",
        },
      ],
    });

    expect(evidence).toEqual([
      {
        domain: "www.federalreserve.gov",
        kind: "fetched_page",
        sourceTier: "primary",
        summary: "The target range was left unchanged.",
        title: "FOMC statement",
        url: "https://www.federalreserve.gov/news.htm",
      },
    ]);
  });

  it("falls back to raw_content, then to a listing when neither is present", () => {
    const [withRaw, bare] = evidenceFromTavilyResponse({
      results: [
        { raw_content: "  Full page text.  ", url: "https://example.com/a" },
        { url: "https://example.com/b" },
      ],
    });

    expect(withRaw?.summary).toBe("Full page text.");
    expect(withRaw?.kind).toBe("fetched_page");
    // No text means no page was really read, so it stays a listing.
    expect(bare?.summary).toBe("Tavily search result.");
    expect(bare?.kind).toBe("search_result");
  });

  it("drops internal and non-http results the same as every other provider", () => {
    const evidence = evidenceFromTavilyResponse({
      results: [
        { content: "ok", url: "https://example.com/ok" },
        {
          content: "metadata",
          url: "http://169.254.169.254/latest/meta-data/",
        },
        { content: "local", url: "http://localhost:5433/" },
        { content: "scheme", url: "file:///etc/passwd" },
        { content: "no url" },
        "not an object",
      ],
    });

    expect(evidence.map((item) => item.url)).toEqual([
      "https://example.com/ok",
    ]);
  });

  it("returns nothing for a malformed payload rather than throwing", () => {
    expect(evidenceFromTavilyResponse({})).toEqual([]);
    expect(evidenceFromTavilyResponse({ results: "nope" })).toEqual([]);
    expect(evidenceFromTavilyResponse(null)).toEqual([]);
    expect(evidenceFromTavilyResponse("nope")).toEqual([]);
  });

  it("truncates a long snippet so one result cannot dominate the trail", () => {
    const [item] = evidenceFromTavilyResponse({
      results: [{ content: "x".repeat(2_000), url: "https://example.com/a" }],
    });

    expect(item?.summary).toHaveLength(500);
  });
});
