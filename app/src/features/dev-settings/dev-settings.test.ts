import { afterEach, describe, expect, it, vi } from "vitest";

import { presentError, setRevealRawErrors } from "@/lib/error-handling";

import {
  devToolsEnabled,
  readRevealRawErrors,
  setRevealRawErrorsSetting,
} from "./dev-settings";

const STORAGE_KEY = "popcharts:dev:reveal-raw-errors:v1";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.localStorage.clear();
  setRevealRawErrors(false);
});

describe("devToolsEnabled", () => {
  it("is true only when the env flag is exactly 'true'", () => {
    expect(devToolsEnabled()).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_DEV_TOOLS_ENABLED", "false");
    expect(devToolsEnabled()).toBe(false);

    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_DEV_TOOLS_ENABLED", "true");
    expect(devToolsEnabled()).toBe(true);
  });
});

describe("readRevealRawErrors", () => {
  it("returns false when nothing is stored", () => {
    expect(readRevealRawErrors()).toBe(false);
  });

  it("returns true only for the stored 'true' value", () => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    expect(readRevealRawErrors()).toBe(true);

    window.localStorage.setItem(STORAGE_KEY, "false");
    expect(readRevealRawErrors()).toBe(false);
  });
});

describe("setRevealRawErrorsSetting", () => {
  it("syncs the presentError override and persists the value", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    setRevealRawErrorsSetting(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("true");
    expect(presentError(new Error("raw detail"), { fallback: "safe copy" })).toBe(
      "raw detail"
    );

    setRevealRawErrorsSetting(false);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("false");
    expect(presentError(new Error("raw detail"), { fallback: "safe copy" })).toBe(
      "safe copy"
    );
  });

  it("still updates the session override when persistence fails", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => setRevealRawErrorsSetting(true)).not.toThrow();
    expect(presentError(new Error("raw detail"), { fallback: "safe copy" })).toBe(
      "raw detail"
    );
  });
});
