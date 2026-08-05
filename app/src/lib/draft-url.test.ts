import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDraftHref, readDraftIdParam, syncDraftIdInUrl } from "./draft-url";

const DRAFT_ID = "k3f9x2mq7rt4wbnz";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("createDraftHref", () => {
  it("links to the create flow for a draft", () => {
    expect(createDraftHref(DRAFT_ID)).toBe(`/create?draft=${DRAFT_ID}`);
  });

  it("escapes an id that would otherwise alter the query", () => {
    expect(createDraftHref("a&b=c")).toBe("/create?draft=a%26b%3Dc");
  });
});

describe("readDraftIdParam", () => {
  it("reads a draft id", () => {
    expect(readDraftIdParam(DRAFT_ID)).toBe(DRAFT_ID);
  });

  it("trims surrounding whitespace", () => {
    expect(readDraftIdParam(`  ${DRAFT_ID}  `)).toBe(DRAFT_ID);
  });

  it("passes through an id it does not recognise", () => {
    // The alphabet and length belong to the server; restating them here would
    // be a second definition to drift. An unknown id comes back not-found.
    expect(readDraftIdParam("whatever-the-server-says")).toBe(
      "whatever-the-server-says"
    );
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["only whitespace", "   "],
    ["absurdly long", "x".repeat(65)],
  ])("returns null for a %s param", (_label, value) => {
    expect(readDraftIdParam(value)).toBeNull();
  });
});

describe("syncDraftIdInUrl", () => {
  it("names the draft without navigating", () => {
    syncDraftIdInUrl(DRAFT_ID);

    expect(window.location.search).toBe(`?draft=${DRAFT_ID}`);
    expect(window.location.pathname).toBe("/");
  });

  it("clears the draft when there is none", () => {
    syncDraftIdInUrl(DRAFT_ID);
    syncDraftIdInUrl(null);

    expect(window.location.search).toBe("");
  });

  it("leaves other query params alone", () => {
    window.history.replaceState(null, "", "/create?from=studio");

    syncDraftIdInUrl(DRAFT_ID);

    expect(window.location.search).toBe(`?from=studio&draft=${DRAFT_ID}`);

    syncDraftIdInUrl(null);

    expect(window.location.search).toBe("?from=studio");
  });

  it("keeps the path and hash", () => {
    window.history.replaceState(null, "", "/create#form");

    syncDraftIdInUrl(DRAFT_ID);

    expect(window.location.pathname).toBe("/create");
    expect(window.location.hash).toBe("#form");
  });

  it("does not touch history when the id is already there", () => {
    window.history.replaceState(null, "", `/create?draft=${DRAFT_ID}`);
    const replaceState = vi.spyOn(window.history, "replaceState");

    // Opening a draft from the studio already put it in the URL; the first
    // autosave must not stack a redundant entry on top of it.
    syncDraftIdInUrl(DRAFT_ID);

    expect(replaceState).not.toHaveBeenCalled();

    replaceState.mockRestore();
  });

  it("does not touch history when clearing an already-bare url", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");

    syncDraftIdInUrl(null);

    expect(replaceState).not.toHaveBeenCalled();

    replaceState.mockRestore();
  });
});
