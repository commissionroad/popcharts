import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseMarketIdArgument } from "../../scripts/shared/market/parseMarketIdArgument.js";

describe("parseMarketIdArgument", function () {
  it("parses a bare uint256 marketId", function () {
    assert.deepEqual(parseMarketIdArgument("9"), { marketId: 9n });
  });

  it("parses the composite chainId:marketId form from the app URL", function () {
    assert.deepEqual(parseMarketIdArgument("31337:9"), { chainId: 31337, marketId: 9n });
  });

  it("tolerates surrounding whitespace", function () {
    assert.deepEqual(parseMarketIdArgument("  31337:9  "), { chainId: 31337, marketId: 9n });
  });

  it("accepts large marketId values without precision loss", function () {
    const id = "340282366920938463463374607431768211456"; // 2**128
    assert.deepEqual(parseMarketIdArgument(id), { marketId: BigInt(id) });
  });

  it("rejects an empty id", function () {
    assert.throws(() => parseMarketIdArgument("   "), /Expected a market id/);
  });

  it("rejects more than two colon-separated parts", function () {
    assert.throws(
      () => parseMarketIdArgument("1:2:3"),
      /expected "marketId" or "chainId:marketId"/,
    );
  });

  it("rejects a non-numeric marketId", function () {
    assert.throws(
      () => parseMarketIdArgument("31337:abc"),
      /market id to be a non-negative integer/,
    );
  });

  it("rejects a non-numeric chain id", function () {
    assert.throws(() => parseMarketIdArgument("local:9"), /chain id to be a non-negative integer/);
  });

  it("rejects a negative marketId", function () {
    assert.throws(() => parseMarketIdArgument("-9"), /non-negative integer/);
  });
});
