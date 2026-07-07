import { beforeEach, describe, expect, it, vi } from "vitest";

import { graduateMarketAction } from "./graduation-actions";

const mocks = vi.hoisted(() => ({
  requestMarketGraduation: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/domain/markets/queries", () => ({
  requestMarketGraduation: mocks.requestMarketGraduation,
}));

beforeEach(() => {
  mocks.requestMarketGraduation.mockReset();
  mocks.revalidatePath.mockReset();
});

describe("graduateMarketAction", () => {
  it("graduates the market and revalidates the market pages", async () => {
    mocks.requestMarketGraduation.mockResolvedValueOnce(undefined);

    const result = await graduateMarketAction("31337:9");

    expect(result).toEqual({
      message: "Graduation finalized onchain. Trading is closed.",
      status: "success",
    });
    expect(mocks.requestMarketGraduation).toHaveBeenCalledWith("31337:9");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/markets/31337:9");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/markets/31337:9/graduation");
  });

  it("surfaces the graduation request's error message", async () => {
    mocks.requestMarketGraduation.mockRejectedValueOnce(
      new Error("Market graduation requires a chain-prefixed market id.")
    );

    const result = await graduateMarketAction("legacy-id");

    expect(result).toEqual({
      message: "Market graduation requires a chain-prefixed market id.",
      status: "error",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("falls back to generic copy when the failure is not an Error", async () => {
    mocks.requestMarketGraduation.mockRejectedValueOnce("boom");

    const result = await graduateMarketAction("31337:9");

    expect(result).toEqual({
      message: "Could not graduate this market.",
      status: "error",
    });
  });
});
