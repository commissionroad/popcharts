import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forceResolveMarketAction } from "./resolution-actions";

const mocks = vi.hoisted(() => ({
  requestDevMarketResolution: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/domain/markets/queries", () => ({
  requestDevMarketResolution: mocks.requestDevMarketResolution,
}));

beforeEach(() => {
  mocks.requestDevMarketResolution.mockReset();
  mocks.revalidatePath.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("forceResolveMarketAction", () => {
  it("resolves the requested side and revalidates the market pages", async () => {
    mocks.requestDevMarketResolution.mockResolvedValueOnce(undefined);

    const result = await forceResolveMarketAction("31337:9", "yes");

    expect(result).toEqual({
      message: "Resolved YES onchain.",
      status: "success",
    });
    expect(mocks.requestDevMarketResolution).toHaveBeenCalledWith("31337:9", "yes");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/markets/31337:9");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/markets/31337:9/graduation");
  });

  it("returns generic copy when forced resolution fails", async () => {
    mocks.requestDevMarketResolution.mockRejectedValueOnce(
      new Error("Dev market resolution is disabled.")
    );

    const result = await forceResolveMarketAction("31337:9", "no");

    expect(result).toEqual({
      message: "Could not resolve this market.",
      status: "error",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("falls back to generic copy when a forced failure is not an Error", async () => {
    mocks.requestDevMarketResolution.mockRejectedValueOnce("boom");

    const result = await forceResolveMarketAction("31337:9", "yes");

    expect(result).toEqual({
      message: "Could not resolve this market.",
      status: "error",
    });
  });
});
