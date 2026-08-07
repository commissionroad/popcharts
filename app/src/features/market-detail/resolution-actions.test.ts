import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { forceResolveMarketAction, settleMarketAction } from "./resolution-actions";

const mocks = vi.hoisted(() => ({
  requestDevMarketResolution: vi.fn(),
  requestMarketResolutionFinalization: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/domain/markets/queries", () => ({
  requestDevMarketResolution: mocks.requestDevMarketResolution,
  requestMarketResolutionFinalization: mocks.requestMarketResolutionFinalization,
}));

beforeEach(() => {
  mocks.requestDevMarketResolution.mockReset();
  mocks.requestMarketResolutionFinalization.mockReset();
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

describe("settleMarketAction", () => {
  it("settles the market and revalidates the pages that show its status", async () => {
    mocks.requestMarketResolutionFinalization.mockResolvedValueOnce({
      message: "Market settled to its proposed outcome.",
      status: "settled",
      transactionHash: `0x${"ab".repeat(32)}`,
    });

    const result = await settleMarketAction("31337:9");

    expect(result).toEqual({ status: "settled" });
    expect(mocks.requestMarketResolutionFinalization).toHaveBeenCalledWith("31337:9");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/markets/31337:9");
  });

  it.each([
    "already_resolved",
    "disputed",
    "no_pending_proposal",
    "not_graduated",
    "window_open",
  ] as const)("passes a %s refusal back as a result, not an error", async (reason) => {
    // A refusal is ordinary operation: the settle call is permissionless, so
    // the keeper or another viewer can move the market between the render and
    // the request. Only the reason travels — the panel owns the copy.
    mocks.requestMarketResolutionFinalization.mockResolvedValueOnce({
      message: "server-facing copy the panel must not show",
      status: reason,
    });

    const result = await settleMarketAction("31337:9");

    expect(result).toEqual({ reason, status: "refused" });
    // Nothing changed on chain, so nothing on the pages is stale.
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns generic copy (not the raw error) when the request fails", async () => {
    mocks.requestMarketResolutionFinalization.mockRejectedValueOnce(
      new Error("Markets API request failed (500): boom")
    );

    const result = await settleMarketAction("31337:9");

    expect(result).toEqual({
      message: "Could not settle this market.",
      status: "error",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("falls back to generic copy when the failure is not an Error", async () => {
    mocks.requestMarketResolutionFinalization.mockRejectedValueOnce("boom");

    const result = await settleMarketAction("legacy-id");

    expect(result).toEqual({
      message: "Could not settle this market.",
      status: "error",
    });
  });
});
