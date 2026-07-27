import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { postgradMarketStatusLabel } from "../../scripts/shared/market/postgradMarketStatusLabel.js";

/**
 * The ordinals themselves are pinned against the Solidity source in
 * contract-enums.test.ts; this covers only the operator-facing labelling of
 * them, including the unknown-code fallback that keeps a future appended
 * member from printing as blank.
 */
describe("postgradMarketStatusLabel", () => {
  it("labels every code by name, and reports one it does not know", () => {
    assert.equal(postgradMarketStatusLabel(0), "Trading (0)");
    assert.equal(postgradMarketStatusLabel(1), "Resolved (1)");
    assert.equal(postgradMarketStatusLabel(2), "Cancelled (2)");
    assert.equal(postgradMarketStatusLabel(3), "ResolutionPending (3)");
    assert.equal(postgradMarketStatusLabel(4), "Disputed (4)");
    assert.equal(postgradMarketStatusLabel(9), "Unknown (9)");
  });
});
