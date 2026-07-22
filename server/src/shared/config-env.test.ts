import { describe, expect, it } from "bun:test";

import {
  normalizeServiceUrl,
  readBoolean,
  readBooleanOrFallback,
  readEnumOrFallback,
  readNonNegativeIntegerOrFallback,
  readPositiveInteger,
  readPositiveIntegerOrFallback,
} from "./config-env";

describe("readPositiveInteger", () => {
  it("falls back when unset or empty", () => {
    expect(readPositiveInteger(undefined, 7, "KNOB")).toBe(7);
    expect(readPositiveInteger("", 7, "KNOB")).toBe(7);
  });

  it("parses a positive integer", () => {
    expect(readPositiveInteger("5000", 7, "KNOB")).toBe(5_000);
  });

  it("throws a named error for zero, negatives, and garbage", () => {
    expect(() => readPositiveInteger("0", 7, "KNOB")).toThrow(
      "KNOB must be a positive integer.",
    );
    expect(() => readPositiveInteger("-1", 7, "KNOB")).toThrow(
      "KNOB must be a positive integer.",
    );
    expect(() => readPositiveInteger("abc", 7, "KNOB")).toThrow(
      "KNOB must be a positive integer.",
    );
  });
});

describe("readBoolean", () => {
  it("falls back when unset or blank", () => {
    expect(readBoolean(undefined, true, "FLAG")).toBe(true);
    expect(readBoolean("  ", false, "FLAG")).toBe(false);
  });

  it("accepts true/1/false/0 case-insensitively with whitespace", () => {
    expect(readBoolean("true", false, "FLAG")).toBe(true);
    expect(readBoolean(" TRUE ", false, "FLAG")).toBe(true);
    expect(readBoolean("1", false, "FLAG")).toBe(true);
    expect(readBoolean("false", true, "FLAG")).toBe(false);
    expect(readBoolean("0", true, "FLAG")).toBe(false);
  });

  it("throws a named error for anything else", () => {
    expect(() => readBoolean("yes", false, "FLAG")).toThrow(
      "FLAG must be true or false.",
    );
  });
});

describe("readPositiveIntegerOrFallback", () => {
  it("parses a positive integer", () => {
    expect(readPositiveIntegerOrFallback("3002", 9)).toBe(3_002);
  });

  it("falls back on unset, zero, negatives, and garbage instead of throwing", () => {
    expect(readPositiveIntegerOrFallback(undefined, 9)).toBe(9);
    expect(readPositiveIntegerOrFallback("0", 9)).toBe(9);
    expect(readPositiveIntegerOrFallback("-1", 9)).toBe(9);
    expect(readPositiveIntegerOrFallback("abc", 9)).toBe(9);
  });
});

describe("readNonNegativeIntegerOrFallback", () => {
  it("admits zero", () => {
    expect(readNonNegativeIntegerOrFallback("0", 9)).toBe(0);
  });

  it("falls back on unset, negatives, and garbage", () => {
    expect(readNonNegativeIntegerOrFallback(undefined, 9)).toBe(9);
    expect(readNonNegativeIntegerOrFallback("-1", 9)).toBe(9);
    expect(readNonNegativeIntegerOrFallback("abc", 9)).toBe(9);
  });
});

describe("readBooleanOrFallback", () => {
  it("falls back when unset or empty", () => {
    expect(readBooleanOrFallback(undefined, true)).toBe(true);
    expect(readBooleanOrFallback("", true)).toBe(true);
  });

  it('reads true only for exactly "true" or "1"; anything else is false', () => {
    expect(readBooleanOrFallback("true", false)).toBe(true);
    expect(readBooleanOrFallback("1", false)).toBe(true);
    expect(readBooleanOrFallback("false", true)).toBe(false);
    expect(readBooleanOrFallback("TRUE", true)).toBe(false);
    expect(readBooleanOrFallback("yes", true)).toBe(false);
  });
});

describe("readEnumOrFallback", () => {
  const MODES = ["off", "provided_urls", "search"] as const;

  it("returns an allowed literal", () => {
    expect(readEnumOrFallback("off", MODES, "search")).toBe("off");
    expect(readEnumOrFallback("search", MODES, "off")).toBe("search");
  });

  it("falls back on unset, empty, and unknown values", () => {
    expect(readEnumOrFallback(undefined, MODES, "search")).toBe("search");
    expect(readEnumOrFallback("", MODES, "search")).toBe("search");
    expect(readEnumOrFallback("everything", MODES, "search")).toBe("search");
    expect(readEnumOrFallback("OFF", MODES, "search")).toBe("search");
  });
});

describe("normalizeServiceUrl", () => {
  it("falls back when unset or blank", () => {
    expect(normalizeServiceUrl(undefined, "http://127.0.0.1:3002")).toBe(
      "http://127.0.0.1:3002",
    );
    expect(normalizeServiceUrl("  ", "http://127.0.0.1:3002")).toBe(
      "http://127.0.0.1:3002",
    );
  });

  it("trims whitespace and strips all trailing slashes", () => {
    expect(normalizeServiceUrl(" http://svc:9000/ ", "fallback")).toBe(
      "http://svc:9000",
    );
    expect(normalizeServiceUrl("http://svc:9000///", "fallback")).toBe(
      "http://svc:9000",
    );
  });
});
