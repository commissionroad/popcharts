import { MARKET_STATUS } from "@popcharts/protocol";
import { describe, expect, it } from "bun:test";

import { marketStatusFromCode } from "./market-status-code";

describe("marketStatusFromCode", () => {
  it("projects the contract's Active as the board's bootstrap", () => {
    // The one mapping that is not a name match, and the one P4 turns on: once
    // the gate lands markets are born Active, and they must land on the
    // discovery board as bootstrap rather than under review.
    expect(marketStatusFromCode(MARKET_STATUS.active)).toBe("bootstrap");
  });

  it("maps every status a market can currently hold", () => {
    expect(marketStatusFromCode(MARKET_STATUS.graduating)).toBe("graduating");
    expect(marketStatusFromCode(MARKET_STATUS.graduated)).toBe("graduated");
    expect(marketStatusFromCode(MARKET_STATUS.refunded)).toBe("refunded");
    expect(marketStatusFromCode(MARKET_STATUS.resolved)).toBe("resolved");
    expect(marketStatusFromCode(MARKET_STATUS.cancelled)).toBe("cancelled");
  });

  it("refuses Frozen rather than inventing a projection for it", () => {
    // Frozen is declared "reserved for future use" and set nowhere in the
    // contracts, so there is no honest markets.status for it. If a future
    // contract starts reaching it, this throw parks the sweep instead of
    // recording the market as something it is not.
    expect(() => marketStatusFromCode(MARKET_STATUS.frozen)).toThrow("Frozen");
  });

  it("names an out-of-range ordinal instead of guessing", () => {
    // The failure a hand-written ordinal table produces when someone appends
    // a member to the Solidity enum: the code arrives, nothing matches, and
    // the error has to be readable enough to point at the enum.
    expect(() => marketStatusFromCode(99)).toThrow("out of range");
  });
});
