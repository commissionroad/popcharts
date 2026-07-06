import { describe, expect, it } from "vitest";

import { cn } from "./cn";

describe("cn", () => {
  it("joins class names with spaces", () => {
    expect(cn("card", "card--active")).toBe("card card--active");
  });

  it("drops falsy entries so conditionals read inline", () => {
    const isActive = false;

    expect(cn("card", isActive && "card--active", null, undefined, "")).toBe("card");
  });

  it("returns an empty string with no truthy entries", () => {
    expect(cn()).toBe("");
    expect(cn(false, null, undefined)).toBe("");
  });
});
