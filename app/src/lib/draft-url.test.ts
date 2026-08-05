import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDraftHref, readDraftIdParam, syncDraftIdInUrl } from "./draft-url";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("createDraftHref", () => {
  it("links to the create flow for a draft", () => {
    expect(createDraftHref(21)).toBe("/create?draft=21");
  });

  it.each([
    ["undefined", undefined],
    ["empty", ""],
    ["non-numeric", "banana"],
    ["beyond safe integers", "9007199254740993000"],
  ])("returns null for a %s param", (_label, value) => {
    expect(readDraftIdParam(value)).toBeNull();
  });
});

describe("syncDraftIdInUrl", () => {
  it("names the draft without navigating", () => {
    syncDraftIdInUrl(21);

    expect(window.location.search).toBe("?draft=21");
    expect(window.location.pathname).toBe("/");
  });

  it("clears the draft when there is none", () => {
    syncDraftIdInUrl(21);
    syncDraftIdInUrl(null);

    expect(window.location.search).toBe("");
  });

  it("leaves other query params alone", () => {
    window.history.replaceState(null, "", "/create?from=studio");

    syncDraftIdInUrl(21);

    expect(window.location.search).toBe("?from=studio&draft=21");

    syncDraftIdInUrl(null);

    expect(window.location.search).toBe("?from=studio");
  });

  it("keeps the path and hash", () => {
    window.history.replaceState(null, "", "/create#form");

    syncDraftIdInUrl(21);

    expect(window.location.pathname).toBe("/create");
    expect(window.location.hash).toBe("#form");
  });

  it("does not touch history when the id is already there", () => {
    window.history.replaceState(null, "", "/create?draft=21");
    const replaceState = vi.spyOn(window.history, "replaceState");

    // Opening a draft from the studio already put it in the URL; the first
    // autosave must not stack a redundant entry on top of it.
    syncDraftIdInUrl(21);

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
