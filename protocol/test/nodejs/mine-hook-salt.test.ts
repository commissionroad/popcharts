import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getCreate2Address, keccak256, type Address, type Hex } from "viem";

import { mineHookSalt } from "../../scripts/shared/contract/mineHookSalt.js";

const DETERMINISTIC_FACTORY: Address = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
// Arbitrary stand-in init code; the miner only hashes it.
const INIT_CODE: Hex = "0x600a600c600039600a6000f3602a60005260206000f3";
// beforeSwap | afterSwap bit layout from v4-core Hooks.sol.
const BEFORE_AND_AFTER_SWAP_FLAGS = (1n << 7n) | (1n << 6n);
const HOOK_PERMISSION_ADDRESS_MASK = (1n << 14n) - 1n;

describe("mineHookSalt", function () {
  it("mines a salt whose CREATE2 address encodes exactly the required flags", function () {
    const { hookAddress, salt } = mineHookSalt({
      deterministicFactory: DETERMINISTIC_FACTORY,
      initCode: INIT_CODE,
      requiredFlags: BEFORE_AND_AFTER_SWAP_FLAGS,
    });

    assert.equal(BigInt(hookAddress) & HOOK_PERMISSION_ADDRESS_MASK, BEFORE_AND_AFTER_SWAP_FLAGS);
    assert.equal(
      hookAddress,
      getCreate2Address({
        bytecodeHash: keccak256(INIT_CODE),
        from: DETERMINISTIC_FACTORY,
        salt,
      }),
    );

    // Same inputs must re-mine the same deployment address.
    const remined = mineHookSalt({
      deterministicFactory: DETERMINISTIC_FACTORY,
      initCode: INIT_CODE,
      requiredFlags: BEFORE_AND_AFTER_SWAP_FLAGS,
    });
    assert.deepEqual(remined, { hookAddress, salt });
  });

  it("rejects flags outside the 14-bit hook permission mask", function () {
    assert.throws(
      () =>
        mineHookSalt({
          deterministicFactory: DETERMINISTIC_FACTORY,
          initCode: INIT_CODE,
          requiredFlags: 1n << 14n,
        }),
      /exceed the 14-bit hook permission mask/,
    );
  });

  it("fails cleanly when the iteration budget is exhausted", function () {
    assert.throws(
      () =>
        mineHookSalt({
          deterministicFactory: DETERMINISTIC_FACTORY,
          initCode: INIT_CODE,
          maxIterations: 1,
          requiredFlags: BEFORE_AND_AFTER_SWAP_FLAGS,
        }),
      /within 1 iterations/,
    );
  });
});
