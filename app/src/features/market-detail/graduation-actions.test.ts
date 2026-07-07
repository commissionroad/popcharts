import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forceGraduateMarketAction, graduateMarketAction } from "./graduation-actions";

const mocks = vi.hoisted(() => ({
  requestDevMarketGraduation: vi.fn(),
  requestMarketGraduation: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/domain/markets/queries", () => ({
  requestDevMarketGraduation: mocks.requestDevMarketGraduation,
  requestMarketGraduation: mocks.requestMarketGraduation,
}));

beforeEach(() => {
  mocks.requestDevMarketGraduation.mockReset();
  mocks.requestMarketGraduation.mockReset();
  mocks.revalidatePath.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
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

  it("forces graduation with dev liquidity top-ups", async () => {
    mocks.requestDevMarketGraduation.mockResolvedValueOnce(undefined);

    const result = await forceGraduateMarketAction("31337:9");

    expect(result).toEqual({
      message: "Forced graduation settled onchain.",
      status: "success",
    });
    expect(mocks.requestDevMarketGraduation).toHaveBeenCalledWith("31337:9", {
      force: true,
    });
  });

  it("surfaces force graduation failures", async () => {
    mocks.requestDevMarketGraduation.mockRejectedValueOnce(
      new Error("Dev market graduation is disabled.")
    );

    const result = await forceGraduateMarketAction("31337:9");

    expect(result).toEqual({
      message: "Dev market graduation is disabled.",
      status: "error",
    });
  });

  it("falls back to generic copy when a forced failure is not an Error", async () => {
    mocks.requestDevMarketGraduation.mockRejectedValueOnce("boom");

    const result = await forceGraduateMarketAction("31337:9");

    expect(result).toEqual({
      message: "Could not graduate this market.",
      status: "error",
    });
  });

  it("drives the dev graduation flow when dev tools are enabled", async () => {
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_DEV_TOOLS_ENABLED", "true");
    mocks.requestDevMarketGraduation.mockResolvedValueOnce(undefined);

    const result = await graduateMarketAction("31337:9");

    expect(result.status).toBe("success");
    expect(mocks.requestDevMarketGraduation).toHaveBeenCalledWith("31337:9");
    expect(mocks.requestMarketGraduation).not.toHaveBeenCalled();
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
