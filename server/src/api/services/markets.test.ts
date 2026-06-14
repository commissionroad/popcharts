import { describe, expect, it } from "bun:test";

import { parseSinceTimestamp } from "./markets";

describe("parseSinceTimestamp", () => {
  it("accepts ISO timestamps", () => {
    expect(parseSinceTimestamp("2026-06-13T12:00:00.000Z")?.toISOString()).toBe(
      "2026-06-13T12:00:00.000Z",
    );
  });

  it("returns null for missing or invalid timestamps", () => {
    expect(parseSinceTimestamp()).toBeNull();
    expect(parseSinceTimestamp("not-a-date")).toBeNull();
  });
});
