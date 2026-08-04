import { describe, expect, it } from "bun:test";

import { collectOpenAiText, evidenceFromOpenAiOutput } from "./openai/evidence";
import type { OpenAiOutputItem } from "./openai/http";

function searchCall({
  sources,
  status = "completed",
}: {
  sources: unknown[];
  status?: string;
}): OpenAiOutputItem {
  return {
    action: { query: "measured value", sources, type: "search" },
    status,
    type: "web_search_call",
  };
}

function message(
  text: string,
  annotations: Array<{ title?: string; type?: string; url?: string }> = [],
): OpenAiOutputItem {
  return {
    content: [{ annotations, text, type: "output_text" }],
    type: "message",
  };
}

describe("evidenceFromOpenAiOutput", () => {
  it("reads every URL the search consulted, not only the cited ones", () => {
    // This is the provider's advantage: `include` returns the full consulted
    // list, so a source the model looked at but did not cite still counts.
    const evidence = evidenceFromOpenAiOutput([
      searchCall({
        sources: [
          {
            snippet: "Official data page.",
            title: "Data",
            url: "https://example.com/a",
          },
          { title: "Second", url: "https://example.com/b" },
        ],
      }),
      message("answer", [
        { title: "Data", type: "url_citation", url: "https://example.com/a" },
      ]),
    ]);

    expect(evidence.map((item) => item.url).sort()).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });

  it("prefers the citation record when a URL is both consulted and cited", () => {
    const evidence = evidenceFromOpenAiOutput([
      searchCall({ sources: [{ url: "https://example.com/a" }] }),
      message("answer", [
        { type: "url_citation", url: "https://example.com/a" },
      ]),
    ]);

    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.kind).toBe("fetched_page");
  });

  it("gives no credit for a search call that did not complete", () => {
    // An in-flight or failed search proves no retrieval, the same rule the
    // Claude Code CLI provider applies to an errored tool result.
    expect(
      evidenceFromOpenAiOutput([
        searchCall({
          sources: [{ url: "https://example.com/a" }],
          status: "in_progress",
        }),
      ]),
    ).toEqual([]);
  });

  it("drops sources that are not public http(s) URLs", () => {
    const evidence = evidenceFromOpenAiOutput([
      searchCall({
        sources: [
          { url: "https://example.com/ok" },
          { url: "http://169.254.169.254/latest/meta-data/" },
          { url: "file:///etc/passwd" },
          { url: 42 },
          "not an object",
          null,
        ],
      }),
    ]);

    expect(evidence.map((item) => item.url)).toEqual([
      "https://example.com/ok",
    ]);
  });

  it("returns nothing when the model reports no search at all", () => {
    expect(evidenceFromOpenAiOutput([message("answered from memory")])).toEqual(
      [],
    );
  });

  it("tolerates output items with missing or malformed fields", () => {
    expect(
      evidenceFromOpenAiOutput([
        { type: "web_search_call", status: "completed" },
        { type: "web_search_call", status: "completed", action: {} },
        { type: "message" },
        { type: "reasoning" },
      ] as OpenAiOutputItem[]),
    ).toEqual([]);
  });
});

describe("collectOpenAiText", () => {
  it("concatenates output_text blocks and ignores other items", () => {
    expect(
      collectOpenAiText([
        { type: "reasoning" },
        searchCall({ sources: [] }),
        message('{"verdict":'),
        message('"approve"}'),
      ]),
    ).toBe('{"verdict":\n"approve"}');
  });
});
