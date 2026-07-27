import { describe, expect, it } from "vitest";

import { isRecord } from "./is-record";

describe("isRecord", () => {
  it("accepts plain objects so their keys can be read", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ metadata: { question: "q" } })).toBe(true);
  });

  it("rejects null and primitives", () => {
    // null is the one every hand-rolled `typeof value === "object"` check
    // forgets, and it is what an absent JSON field parses to.
    expect(isRecord(null)).toBe(false);
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("{}")).toBe(false);
    expect(isRecord(7)).toBe(false);
  });

  it("accepts arrays, which callers needing a plain object must exclude", () => {
    expect(isRecord([])).toBe(true);
  });
});
