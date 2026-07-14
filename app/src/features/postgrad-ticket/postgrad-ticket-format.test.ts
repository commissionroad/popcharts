import { describe, expect, it } from "vitest";

import {
  formatSwapStep,
  formatVenueBalance,
  formatVenueTokens,
} from "./postgrad-ticket-format";

describe("formatSwapStep", () => {
  it.each([
    ["approving", "Approving router spend..."],
    ["confirming", "Waiting for confirmation..."],
    ["minting", "Minting local test pUSD..."],
    ["swapping", "Submitting swap..."],
  ] as const)("labels the %s step", (step, label) => {
    expect(formatSwapStep(step)).toBe(label);
  });
});

describe("formatVenueBalance", () => {
  const base = {
    balance: 1_234.5,
    error: null,
    isLoading: false,
    unit: "pUSD",
    walletConnected: true,
  };

  it("prompts to connect before showing numbers", () => {
    expect(formatVenueBalance({ ...base, walletConnected: false })).toBe(
      "Connect wallet"
    );
  });

  it("reports loading", () => {
    expect(formatVenueBalance({ ...base, isLoading: true })).toBe("Loading...");
  });

  it("reports read errors as unavailable", () => {
    expect(formatVenueBalance({ ...base, error: "rpc down" })).toBe("Unavailable");
  });

  it("shows a dash while the balance is unknown", () => {
    expect(formatVenueBalance({ ...base, balance: null })).toBe("--");
  });

  it("drops decimals from 100 up and keeps them below", () => {
    expect(formatVenueBalance(base)).toBe("1,235 pUSD");
    expect(formatVenueBalance({ ...base, balance: 12.3, unit: "tok" })).toBe(
      "12.30 tok"
    );
    expect(formatVenueBalance({ ...base, balance: 0 })).toBe("0 pUSD");
  });
});

describe("formatVenueTokens", () => {
  it("rounds to whole tokens from 1,000 up", () => {
    expect(formatVenueTokens(12_345.6)).toBe("12,346");
  });

  it("keeps two decimals below 1,000", () => {
    expect(formatVenueTokens(190.456)).toBe("190.46");
  });
});
