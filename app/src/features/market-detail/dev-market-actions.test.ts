import { beforeEach, describe, expect, it, vi } from "vitest";

import { closePregradMarketAction } from "./dev-market-actions";

const mocks = vi.hoisted(() => ({
  requestPregradMarketCloseForRefund: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/domain/markets/queries", () => ({
  requestPregradMarketCloseForRefund: mocks.requestPregradMarketCloseForRefund,
}));

beforeEach(() => {
  mocks.requestPregradMarketCloseForRefund.mockReset();
  mocks.revalidatePath.mockReset();
});

describe("closePregradMarketAction", () => {
  it("closes the market and revalidates the affected pages", async () => {
    mocks.requestPregradMarketCloseForRefund.mockResolvedValueOnce(undefined);

    const result = await closePregradMarketAction("31337:9");

    expect(result).toEqual({
      message: "Closed for refunds.",
      status: "success",
    });
    expect(mocks.requestPregradMarketCloseForRefund).toHaveBeenCalledWith("31337:9");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/markets/31337:9");
  });

  it("returns generic copy (not the raw error) when the close request fails", async () => {
    mocks.requestPregradMarketCloseForRefund.mockRejectedValueOnce(
      new Error("Dev market close requires API-backed market data.")
    );

    const result = await closePregradMarketAction("31337:9");

    expect(result).toEqual({
      message: "Could not close this market for refunds.",
      status: "error",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("falls back to generic copy when the failure is not an Error", async () => {
    mocks.requestPregradMarketCloseForRefund.mockRejectedValueOnce("boom");

    const result = await closePregradMarketAction("31337:9");

    expect(result).toEqual({
      message: "Could not close this market for refunds.",
      status: "error",
    });
  });
});
