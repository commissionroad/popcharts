import { describe, expect, it } from "bun:test";
import { BaseError, NonceTooLowError } from "viem";

import { isNonceCollision, retryOnceOnNonceCollision } from "./nonce-collision";

// The message the local dev node returns when a concurrent sender took the
// nonce first and its transaction was mined; this is the exact text observed
// in the lifecycle nightly suite.
const NONCE_TOO_LOW =
  "Nonce too low. Expected nonce to be 44 but got 43. Note that transactions " +
  "can't be queued when automining.";

// The dev node's wording when a transaction is still *pending* at the nonce
// and the new one did not outbid it. The pending transaction stays; the nonce
// is not free, so this is not a retryable race.
const REPLACEMENT_UNDERPRICED =
  "Replacement transaction underpriced. A gasPrice/maxFeePerGas of at least " +
  "1000000000 is necessary to replace the existing transaction with nonce 43.";

// A geth-family node's wording when the identical raw transaction is already
// in its pool — ours was accepted, so there is nothing to retry.
const ALREADY_KNOWN = "already known";

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
    expect(isNonceCollision(new Error(NONCE_TOO_LOW))).toBe(true);
  });

  it("does not claim unrelated failures", () => {
    expect(isNonceCollision(new Error("execution reverted"))).toBe(false);
    expect(isNonceCollision("not an error")).toBe(false);
  });

  // The next three pin the narrowing. Each of these was matched by the old
  // pattern, and each would resend a transaction that is still alive.
  it("does not claim an accepted transaction the node already holds", () => {
    expect(isNonceCollision(new Error(ALREADY_KNOWN))).toBe(false);
  });

  it("does not claim an accepted transaction viem relabelled as nonce-too-low", () => {
    // viem folds "already known" into NonceTooLowError, so the wrapper's own
    // wording talks about nonces even though our transaction was accepted.
    // Classifying on viem's synthesized message instead of the node's would
    // re-admit exactly the case this module must refuse.
    const error = new NonceTooLowError({
      cause: new BaseError("RPC Request failed.", {
        cause: new Error(ALREADY_KNOWN),
      }),
    });

    expect(isNonceCollision(error)).toBe(false);
  });

  it("does not claim a still-pending transaction at the same nonce", () => {
    expect(isNonceCollision(new Error(REPLACEMENT_UNDERPRICED))).toBe(false);
  });

  it("does not claim a contract revert that merely mentions a nonce", () => {
    const error = new BaseError("Transaction execution failed", {
      cause: new BaseError(
        'The contract function "permitTransferFrom" reverted.\n' +
          "Error: InvalidNonce()",
      ),
    });

    expect(isNonceCollision(error)).toBe(false);
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

  it("never re-sends a transaction the node already accepted", async () => {
    let attempts = 0;
    const send = async () => {
      attempts += 1;
      throw new Error(ALREADY_KNOWN);
    };

    await expect(retryOnceOnNonceCollision(send)).rejects.toThrow(
      ALREADY_KNOWN,
    );
    expect(attempts).toBe(1);
  });

  it("never re-sends when a transaction is still pending at the nonce", async () => {
    let attempts = 0;
    const send = async () => {
      attempts += 1;
      throw new Error(REPLACEMENT_UNDERPRICED);
    };

    await expect(retryOnceOnNonceCollision(send)).rejects.toThrow(
      "Replacement transaction underpriced",
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
