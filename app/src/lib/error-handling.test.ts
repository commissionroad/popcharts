import { describe, expect, it } from "vitest";

import { getErrorMessage } from "./error-handling";

describe("getErrorMessage", () => {
  it("returns the fallback for non-Error values", () => {
    expect(getErrorMessage("boom", { fallback: "fell back" })).toBe("fell back");
    expect(getErrorMessage(undefined, { fallback: "fell back" })).toBe("fell back");
    expect(getErrorMessage(null, { fallback: "fell back" })).toBe("fell back");
    expect(getErrorMessage({ message: "shaped" }, { fallback: "fell back" })).toBe(
      "fell back"
    );
  });

  it("returns error.message for Error values", () => {
    expect(getErrorMessage(new Error("broke"), { fallback: "fell back" })).toBe(
      "broke"
    );
  });

  it("returns an empty message verbatim when no matcher intervenes", () => {
    expect(getErrorMessage(new Error(""), { fallback: "fell back" })).toBe("");
  });

  it("uses the matcher result when it returns a string", () => {
    const message = getErrorMessage(new Error("custom error 0xdead"), {
      fallback: "fell back",
      matcher: (error) =>
        error.message.includes("0xdead") ? "friendly copy" : undefined,
    });

    expect(message).toBe("friendly copy");
  });

  it("falls through to error.message when the matcher returns undefined", () => {
    const message = getErrorMessage(new Error("unmatched"), {
      fallback: "fell back",
      matcher: () => undefined,
    });

    expect(message).toBe("unmatched");
  });

  it("does not invoke the matcher for non-Error values", () => {
    let called = false;

    const message = getErrorMessage("not an error", {
      fallback: "fell back",
      matcher: () => {
        called = true;
        return "should not appear";
      },
    });

    expect(message).toBe("fell back");
    expect(called).toBe(false);
  });

  it("lets a matcher map an empty message to the fallback", () => {
    const message = getErrorMessage(new Error(""), {
      fallback: "fell back",
      matcher: (error) => (error.message ? undefined : "fell back"),
    });

    expect(message).toBe("fell back");
  });
});
