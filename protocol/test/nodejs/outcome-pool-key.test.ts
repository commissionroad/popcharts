import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildOutcomePoolKey, computePoolId } from "../../src/market/outcomePoolKey.js";

const HOOK = "0x00000000000000000000000000000000000000f1" as const;
const OTHER_HOOK = "0x00000000000000000000000000000000000000f2" as const;
const COLLATERAL = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const LOW_TOKEN = "0x0000000000000000000000000000000000000abc" as const;
const HIGH_TOKEN = "0xffffffffffffffffffffffffffffffffffffffff" as const;

describe("buildOutcomePoolKey", function () {
  it("sorts the outcome token below collateral when its address is lower", function () {
    const { key, outcomeIsCurrency0 } = buildOutcomePoolKey({
      boundedHook: HOOK,
      collateral: COLLATERAL,
      outcomeToken: LOW_TOKEN,
    });

    assert.equal(outcomeIsCurrency0, true);
    assert.equal(key.currency0, LOW_TOKEN);
    assert.equal(key.currency1, COLLATERAL);
    assert.equal(key.fee, 3000);
    assert.equal(key.tickSpacing, 60);
    assert.equal(key.hooks, HOOK);
  });

  it("sorts collateral first when the outcome token address is higher", function () {
    const { key, outcomeIsCurrency0 } = buildOutcomePoolKey({
      boundedHook: HOOK,
      collateral: COLLATERAL,
      outcomeToken: HIGH_TOKEN,
    });

    assert.equal(outcomeIsCurrency0, false);
    assert.equal(key.currency0, COLLATERAL);
    assert.equal(key.currency1, HIGH_TOKEN);
  });

  // Guards the numeric comparison specifically. These two addresses sort one
  // way by value and the other way as strings once the first is uppercased,
  // because "F" (0x46) sorts below "a" (0x61) — so a lexicographic
  // implementation flips here and a numeric one does not.
  it("sorts by address value, not lexicographically", function () {
    const higher = "0xf0000000000000000000000000000000000000ff" as const;
    const lower = "0xa0000000000000000000000000000000000000aa" as const;

    const lowercased = buildOutcomePoolKey({
      boundedHook: HOOK,
      collateral: lower,
      outcomeToken: higher,
    });
    const uppercased = buildOutcomePoolKey({
      boundedHook: HOOK,
      collateral: lower,
      outcomeToken: higher.toUpperCase().replace("0X", "0x") as `0x${string}`,
    });

    assert.equal(lowercased.outcomeIsCurrency0, false);
    assert.equal(uppercased.outcomeIsCurrency0, false);
  });
});

describe("computePoolId", function () {
  const { key } = buildOutcomePoolKey({
    boundedHook: HOOK,
    collateral: COLLATERAL,
    outcomeToken: LOW_TOKEN,
  });
  const poolId = computePoolId(key);

  it("is a deterministic 32-byte hash of the key", function () {
    assert.match(poolId, /^0x[0-9a-f]{64}$/);
    assert.equal(poolId, computePoolId({ ...key }));
  });

  // Every field is checked individually: the pool id is the pool's identity,
  // so a field silently dropped from the encoded tuple would still produce a
  // plausible-looking hash while addressing the wrong pool.
  it("changes when any single key field changes", function () {
    const variants = [
      { ...key, currency0: HIGH_TOKEN },
      { ...key, currency1: HIGH_TOKEN },
      { ...key, fee: 500 },
      { ...key, tickSpacing: 10 },
      { ...key, hooks: OTHER_HOOK },
    ];

    for (const variant of variants) {
      assert.notEqual(computePoolId(variant), poolId);
    }
  });
});
