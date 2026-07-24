import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { WAD, wadToCents, wadToNumber } from "../../src/wad.js";

describe("WAD", function () {
  it("is one whole unit at 18 implied decimals", function () {
    assert.equal(WAD, 10n ** 18n);
  });
});

describe("wadToNumber", function () {
  it("converts zero", function () {
    assert.equal(wadToNumber(0n), 0);
  });

  it("converts whole WAD multiples exactly", function () {
    assert.equal(wadToNumber(WAD), 1);
    assert.equal(wadToNumber(5_000n * WAD), 5_000);
  });

  it("keeps the fractional part", function () {
    assert.equal(wadToNumber(WAD / 2n), 0.5);
    assert.equal(wadToNumber(WAD + WAD / 4n), 1.25);
  });

  it("converts values smaller than one wei of a token", function () {
    assert.equal(wadToNumber(1n), 1e-18);
  });

  it("reconstructs negative values from their whole and fractional parts", function () {
    assert.equal(wadToNumber(-WAD), -1);
    assert.equal(wadToNumber(-(WAD + WAD / 2n)), -1.5);
  });

  it("keeps the whole part exact past the float-exact integer range", function () {
    // The integer part alone exceeds 2^53; splitting it off keeps it exact
    // where Number(value) / 1e18 would round the low digits away.
    assert.equal(wadToNumber(1_000_000_000n * WAD), 1_000_000_000);
  });
});

describe("wadToCents", function () {
  it("rounds a half probability to fifty cents", function () {
    assert.equal(wadToCents(WAD / 2n), 50);
  });

  it("rounds half up", function () {
    // 0.505 -> 51, 0.504 -> 50.
    assert.equal(wadToCents(505_000_000_000_000_000n), 51);
    assert.equal(wadToCents(504_000_000_000_000_000n), 50);
  });

  it("clamps away from the 0 and 100 asymptotes", function () {
    assert.equal(wadToCents(0n), 1);
    assert.equal(wadToCents(WAD), 99);
    assert.equal(wadToCents(2n * WAD), 99);
  });
});
