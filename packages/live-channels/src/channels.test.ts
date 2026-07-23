// The channel vocabulary both the relay and the browser import (repo ADR 0021).
import { describe, expect, it } from "bun:test";

import {
  MARKET_LIST_CHANNEL,
  marketChannel,
  portfolioChannel,
} from "./channels";

describe("channel vocabulary", () => {
  it("keys a market channel by chain and market", () => {
    expect(marketChannel(31337, "42")).toBe("market:31337:42");
  });

  it("lower-cases the portfolio channel so either side's casing matches", () => {
    expect(portfolioChannel("0xABC")).toBe("portfolio:0xabc");
    expect(portfolioChannel("0xabc")).toBe("portfolio:0xabc");
  });

  it("names one global discovery channel", () => {
    expect(MARKET_LIST_CHANNEL).toBe("markets");
  });
});
