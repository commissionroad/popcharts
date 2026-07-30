import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GeneratedLocalMarket } from "@/integrations/local-market-generator/types";
import { DisplayableError } from "@/lib/error-handling";

import { subscribeToGeneratedMarketFill } from "./generated-market-events";
import { fetchGeneratedLocalMarket } from "./generated-market-service";
import { useGeneratedMarketFill } from "./use-generated-market-fill";

vi.mock("./generated-market-service", () => ({
  fetchGeneratedLocalMarket: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchGeneratedLocalMarket).mockResolvedValue(weatherMarket());
});

describe("useGeneratedMarketFill", () => {
  it("announces the generated market and reports what it filled", async () => {
    const onFill = vi.fn();
    const unsubscribe = subscribeToGeneratedMarketFill(onFill);
    const { result } = renderHook(() => useGeneratedMarketFill(true));

    await act(async () => {
      result.current.action.onClick?.();
    });

    expect(onFill).toHaveBeenCalledWith(weatherMarket());
    expect(result.current.result).toEqual({
      message: "Filled the form with a Weather market.",
      status: "success",
    });
    expect(result.current.isGenerating).toBe(false);

    unsubscribe();
  });

  it("shows a spinner label and blocks a second click while generating", async () => {
    let release: (market: GeneratedLocalMarket) => void = () => undefined;
    vi.mocked(fetchGeneratedLocalMarket).mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      })
    );
    const { result } = renderHook(() => useGeneratedMarketFill(true));

    act(() => {
      result.current.action.onClick?.();
    });

    await waitFor(() => expect(result.current.isGenerating).toBe(true));
    expect(result.current.action).toMatchObject({
      disabled: true,
      label: "Generating",
      onClick: undefined,
    });

    await act(async () => {
      release(weatherMarket());
    });

    expect(result.current.isGenerating).toBe(false);
  });

  it("reports a generation failure and announces nothing", async () => {
    const onFill = vi.fn();
    const unsubscribe = subscribeToGeneratedMarketFill(onFill);
    vi.mocked(fetchGeneratedLocalMarket).mockRejectedValue(
      new DisplayableError("Local dev tools are not enabled.")
    );
    const { result } = renderHook(() => useGeneratedMarketFill(true));

    await act(async () => {
      result.current.action.onClick?.();
    });

    expect(onFill).not.toHaveBeenCalled();
    expect(result.current.result).toEqual({
      message: "Local dev tools are not enabled.",
      status: "error",
    });

    unsubscribe();
  });

  it("offers nothing to click while the create form is not on screen", () => {
    const { result } = renderHook(() => useGeneratedMarketFill(false));

    expect(result.current.action).toEqual({
      disabled: true,
      label: "Random market",
      onClick: undefined,
    });
  });
});

function weatherMarket(): GeneratedLocalMarket {
  return {
    graduationAt: "2030-07-01T13:00:00.000Z",
    metadata: {
      category: "Weather",
      createdAt: "2030-07-01T12:00:00.000Z",
      description: "Auto-generated local-dev market.",
      question: "Will the max NYC METAR temperature be higher than 80°F?",
      resolutionCriteria: "Resolve YES if the max observation is higher.",
      version: 1,
    },
    resolutionAt: "2030-07-01T14:00:00.000Z",
  };
}
