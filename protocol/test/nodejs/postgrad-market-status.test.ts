import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { POSTGRAD_MARKET_STATUS } from "../../src/postgrad-market-status.js";
import { postgradMarketStatusLabel } from "../../scripts/shared/market/postgradMarketStatusLabel.js";

/**
 * POSTGRAD_MARKET_STATUS mirrors the CompleteSetBinaryMarket.Status Solidity
 * enum, which has no ABI representation to check against — so this pins the
 * shape a reviewer verified against CompleteSetBinaryMarket.sol, in the style
 * of the market-status.test.ts pin for MarketTypes.MarketStatus. The enum is
 * append-only: the optimistic-resolution states were added after the terminal
 * ones, so the codes are deliberately not lifecycle order.
 */
describe("POSTGRAD_MARKET_STATUS (CompleteSetBinaryMarket.Status mirror)", () => {
  it("covers five codes, with the optimistic-resolution states appended last", () => {
    assert.deepEqual(POSTGRAD_MARKET_STATUS, {
      cancelled: 2,
      disputed: 4,
      resolutionPending: 3,
      resolved: 1,
      trading: 0,
    });
  });

  it("labels every code by name, and reports one it does not know", () => {
    assert.equal(postgradMarketStatusLabel(0), "Trading (0)");
    assert.equal(postgradMarketStatusLabel(1), "Resolved (1)");
    assert.equal(postgradMarketStatusLabel(2), "Cancelled (2)");
    assert.equal(postgradMarketStatusLabel(3), "ResolutionPending (3)");
    assert.equal(postgradMarketStatusLabel(4), "Disputed (4)");
    assert.equal(postgradMarketStatusLabel(9), "Unknown (9)");
  });
});
