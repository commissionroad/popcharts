import { afterEach, describe, expect, it, vi } from "vitest";

import { DisplayableError, getErrorMessage, presentError } from "./error-handling";

describe("getErrorMessage", () => {
  it("returns the fallback for non-Error values", () => {
    expect(getErrorMessage("boom", { fallback: "fell back" })).toBe("fell back");
    expect(getErrorMessage(undefined, { fallback: "fell back" })).toBe("fell back");
    expect(getErrorMessage(null, { fallback: "fell back" })).toBe("fell back");
    expect(getErrorMessage({ message: "shaped" }, { fallback: "fell back" })).toBe(
      "fell back"
    );
  });

  it("returns the fallback for an unrecognized Error instead of its raw message", () => {
    expect(getErrorMessage(new Error("broke"), { fallback: "fell back" })).toBe(
      "fell back"
    );
  });

  it("returns the fallback for an empty message", () => {
    expect(getErrorMessage(new Error(""), { fallback: "fell back" })).toBe("fell back");
  });

  it("uses the matcher result when it returns a string", () => {
    const message = getErrorMessage(new Error("custom error 0xdead"), {
      fallback: "fell back",
      matcher: (error) =>
        error.message.includes("0xdead") ? "friendly copy" : undefined,
    });

    expect(message).toBe("friendly copy");
  });

  it("falls through to the fallback when the matcher returns undefined", () => {
    const message = getErrorMessage(new Error("unmatched"), {
      fallback: "fell back",
      matcher: () => undefined,
    });

    expect(message).toBe("fell back");
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

  it("maps shared known errors to friendly copy without a matcher", () => {
    expect(
      getErrorMessage(new Error("MetaMask Tx Signature: User rejected the request."), {
        fallback: "fell back",
      })
    ).toBe("Request cancelled in your wallet.");

    expect(
      getErrorMessage(
        new Error("Transaction gas limit is 21000000 and exceeds transaction gas cap"),
        { fallback: "fell back" }
      )
    ).toBe(
      "This transaction is too large for the network to accept right now. Try a smaller amount."
    );

    expect(
      getErrorMessage(new Error("insufficient funds for gas * price + value"), {
        fallback: "fell back",
      })
    ).toBe(
      "Your wallet doesn't have enough funds to cover this transaction's network fee."
    );

    expect(
      getErrorMessage(new Error("TypeError: Failed to fetch"), {
        fallback: "fell back",
      })
    ).toBe("Network problem reaching the chain. Check your connection and try again.");
  });

  it("lets the matcher take precedence over shared known copy", () => {
    const message = getErrorMessage(new Error("User rejected the request."), {
      fallback: "fell back",
      matcher: () => "surface-specific copy",
    });

    expect(message).toBe("surface-specific copy");
  });

  it("shows a DisplayableError's message verbatim", () => {
    expect(
      getErrorMessage(new DisplayableError("Invalid resolutionTime."), {
        fallback: "fell back",
      })
    ).toBe("Invalid resolutionTime.");
  });

  it("still lets a matcher override a DisplayableError", () => {
    expect(
      getErrorMessage(new DisplayableError("raw-ish"), {
        fallback: "fell back",
        matcher: () => "matched",
      })
    ).toBe("matched");
  });
});

describe("presentError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the raw error and returns the safe message", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("internal RPC detail nobody should read");

    const message = presentError(error, {
      fallback: "Could not do the thing.",
      context: { operation: "unit-test" },
    });

    expect(message).toBe("Could not do the thing.");
    expect(consoleSpy).toHaveBeenCalledWith("[popcharts] error", error, {
      operation: "unit-test",
    });
  });

  it("still applies the matcher when logging", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const message = presentError(new Error("boom"), {
      fallback: "fell back",
      matcher: () => "matched copy",
    });

    expect(message).toBe("matched copy");
  });
});
