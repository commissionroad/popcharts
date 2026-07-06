import { describe, expect, it } from "vitest";

import { invariant } from "./invariant";

describe("invariant", () => {
  it("does nothing when the condition holds", () => {
    expect(() => invariant(true, "unused")).not.toThrow();
    expect(() => invariant("value", "unused")).not.toThrow();
    expect(() => invariant(1, "unused")).not.toThrow();
  });

  it("throws the given message on falsy conditions", () => {
    expect(() => invariant(false, "must hold")).toThrow("must hold");
    expect(() => invariant(null, "no null")).toThrow("no null");
    expect(() => invariant(undefined, "no undefined")).toThrow("no undefined");
    expect(() => invariant(0, "no zero")).toThrow("no zero");
    expect(() => invariant("", "no empty")).toThrow("no empty");
  });

  it("narrows the checked value for the code that follows", () => {
    const value: string | null = "narrowed" as string | null;

    invariant(value, "value must exist");

    // Type-level check: .length is only reachable when narrowing worked.
    expect(value.length).toBe(8);
  });
});
