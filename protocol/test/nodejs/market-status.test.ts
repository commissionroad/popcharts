import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MARKET_STATUS } from "../../src/market-status.js";

/**
 * MARKET_STATUS mirrors the MarketTypes.MarketStatus Solidity enum, which
 * has no ABI representation to check against — so this pins the shape a
 * reviewer verified against MarketTypes.sol: nine consecutive codes in
 * declaration order. An enum edit that changes the count or order must
 * come back through here.
 */
describe("MARKET_STATUS (MarketTypes.MarketStatus mirror)", () => {
  it("covers nine consecutive codes in enum declaration order", () => {
    assert.deepEqual(Object.values(MARKET_STATUS), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(MARKET_STATUS.active, 0);
    assert.equal(MARKET_STATUS.graduated, 3);
    assert.equal(MARKET_STATUS.refunded, 4);
    assert.equal(MARKET_STATUS.underReview, 7);
    assert.equal(MARKET_STATUS.rejected, 8);
  });
});
