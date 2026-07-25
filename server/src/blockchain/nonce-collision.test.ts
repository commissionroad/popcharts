import { describe, expect, it } from "bun:test";
import { BaseError } from "viem";

import { isNonceCollision, retryOnceOnNonceCollision } from "./nonce-collision";

// The message hardhat returns when a concurrent sender took the nonce first;
// this is the exact text observed in the lifecycle nightly suite.
const NONCE_TOO_LOW =
  "Nonce too low. Expected nonce to be 44 but got 43. Note that transactions " +
  "can't be queued when automining.";

describe("isNonceCollision", () => {
  it("recognizes a collision reported on a nested cause", () => {
    const error = new BaseError("Transaction execution failed", {
      cause: new BaseError("RPC Request failed.", {
        cause: new Error(NONCE_TOO_LOW),
      }),
    });

    expect(isNonceCollision(error)).toBe(true);
  });

  it("recognizes a collision on a plain error", () => {
    expect(isNonceCollision(new Error("already known"))).toBe(true);
  });

  it("does not claim unrelated failures", () => {
    expect(isNonceCollision(new Error("execution reverted"))).toBe(false);
    expect(isNonceCollision("not an error")).toBe(false);
  });
});

describe("retryOnceOnNonceCollision", () => {
  it("re-sends once after a collision", async () => {
    let attempts = 0;
    const send = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error(NONCE_TOO_LOW);
      }
      return "0xhash";
    };

    expect(await retryOnceOnNonceCollision(send)).toBe("0xhash");
    expect(attempts).toBe(2);
  });

  it("rethrows a non-collision failure without re-sending", async () => {
    let attempts = 0;
    const send = async () => {
      attempts += 1;
      throw new Error("execution reverted");
    };

    await expect(retryOnceOnNonceCollision(send)).rejects.toThrow(
      "execution reverted",
    );
    expect(attempts).toBe(1);
  });

  it("gives up after a single retry so a persistent race stays visible", async () => {
    let attempts = 0;
    const send = async () => {
      attempts += 1;
      throw new Error(NONCE_TOO_LOW);
    };

    await expect(retryOnceOnNonceCollision(send)).rejects.toThrow(
      "Nonce too low",
    );
    expect(attempts).toBe(2);
  });
});
