import { afterEach, describe, expect, it, vi } from "vitest";

import { logError, setErrorTransport } from "./error-logger";

describe("logError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setErrorTransport(null);
  });

  it("always writes the raw error and context to the console", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");

    logError(error, { operation: "test" });

    expect(consoleSpy).toHaveBeenCalledWith("[popcharts] error", error, {
      operation: "test",
    });
  });

  it("defaults the context to an empty object", () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    logError("not an error");

    expect(consoleSpy).toHaveBeenCalledWith("[popcharts] error", "not an error", {});
  });

  it("forwards the error and context to the configured transport", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = vi.fn();
    setErrorTransport(transport);

    const error = new Error("boom");
    logError(error, { marketId: "m1" });

    expect(transport).toHaveBeenCalledWith({
      context: { marketId: "m1" },
      error,
    });
  });

  it("swallows a throwing transport so logging never breaks the app", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    setErrorTransport(() => {
      throw new Error("sink is down");
    });

    expect(() => logError(new Error("boom"))).not.toThrow();
  });

  it("stops forwarding once the transport is removed", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const transport = vi.fn();
    setErrorTransport(transport);
    setErrorTransport(null);

    logError(new Error("boom"));

    expect(transport).not.toHaveBeenCalled();
  });
});
