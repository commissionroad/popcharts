import { describe, expect, it } from "bun:test";

import {
  DRAFT_PUBLIC_ID_LENGTH,
  isDraftPublicId,
  newDraftPublicId,
} from "./public-id";

describe("newDraftPublicId", () => {
  it("mints ids of the declared length", () => {
    expect(newDraftPublicId()).toHaveLength(DRAFT_PUBLIC_ID_LENGTH);
  });

  it("mints ids the validator accepts", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isDraftPublicId(newDraftPublicId())).toBe(true);
    }
  });

  it("never emits a look-alike character", () => {
    // 0/1/l/o are excluded by construction; if the alphabet ever regains one,
    // ids stop being safe to read aloud or retype.
    const ids = Array.from({ length: 500 }, () => newDraftPublicId()).join("");

    expect(ids).not.toMatch(/[01lo]/);
  });

  it("uses the whole alphabet", () => {
    // A modulo bug against a non-power-of-two alphabet would show up as
    // symbols that never appear, so assert every one of the 32 is reachable.
    const seen = new Set(
      Array.from({ length: 2_000 }, () => newDraftPublicId()).join(""),
    );

    expect(seen.size).toBe(32);
  });

  it("does not repeat itself", () => {
    const ids = new Set(
      Array.from({ length: 1_000 }, () => newDraftPublicId()),
    );

    expect(ids.size).toBe(1_000);
  });
});

describe("isDraftPublicId", () => {
  it("accepts a well-formed id", () => {
    expect(isDraftPublicId("k3f9x2mq7rt4wbnz")).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["too short", "k3f9x2mq7rt4wbn"],
    ["too long", "k3f9x2mq7rt4wbnzz"],
    ["a serial id", "21"],
    ["uppercase", "K3F9X2MQ7RT4WBNZ"],
    ["an excluded look-alike", "k3f9x2mq7rt4wbn0"],
    ["punctuation", "k3f9x2mq-rt4wbnz"],
    ["a wildcard", "k3f9x2mq7rt4wbn%"],
  ])("rejects %s", (_label, value) => {
    expect(isDraftPublicId(value)).toBe(false);
  });
});
