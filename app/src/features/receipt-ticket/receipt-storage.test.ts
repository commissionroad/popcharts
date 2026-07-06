import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { PlacedPregradReceipt } from "@/domain/pregrad-trading/receipt-quote";

import { recordPlacedReceipt, useStoredReceipts } from "./receipt-storage";

const STORAGE_KEY = "popcharts:placed-pregrad-receipts:v1";

afterEach(() => {
  window.localStorage.clear();
});

describe("recordPlacedReceipt", () => {
  it("stores the receipt newest first", () => {
    recordPlacedReceipt(placedReceipt({ id: "31337:1" }));
    recordPlacedReceipt(placedReceipt({ id: "31337:2" }));

    expect(storedIds()).toEqual(["31337:2", "31337:1"]);
  });

  it("replaces an existing receipt with the same id", () => {
    recordPlacedReceipt(placedReceipt({ id: "31337:1", shares: 10 }));
    recordPlacedReceipt(placedReceipt({ id: "31337:2" }));
    recordPlacedReceipt(placedReceipt({ id: "31337:1", shares: 99 }));

    expect(storedIds()).toEqual(["31337:1", "31337:2"]);
    expect(storedReceipts()[0]?.shares).toBe(99);
  });

  it("caps stored receipts at 50, evicting the oldest", () => {
    for (let index = 1; index <= 55; index += 1) {
      recordPlacedReceipt(placedReceipt({ id: `31337:${index}` }));
    }

    const ids = storedIds();

    expect(ids).toHaveLength(50);
    expect(ids[0]).toBe("31337:55");
    expect(ids.at(-1)).toBe("31337:6");
  });

  it("recovers when existing storage is corrupt", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");

    recordPlacedReceipt(placedReceipt({ id: "31337:1" }));

    expect(storedIds()).toEqual(["31337:1"]);
  });
});

describe("useStoredReceipts", () => {
  it("reads stored receipts on mount", () => {
    recordPlacedReceipt(placedReceipt({ id: "31337:1" }));

    const { result } = renderHook(() => useStoredReceipts());

    expect(result.current.map((receipt) => receipt.id)).toEqual(["31337:1"]);
  });

  it("returns an empty list when storage holds a non-array value", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: "31337:1" }));

    const { result } = renderHook(() => useStoredReceipts());

    expect(result.current).toEqual([]);
  });

  it("returns an empty list when storage holds invalid JSON", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");

    const { result } = renderHook(() => useStoredReceipts());

    expect(result.current).toEqual([]);
  });

  it("silently drops malformed entries", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        placedReceipt({ id: "31337:1" }),
        { id: "31337:2" },
        { ...placedReceipt({ id: "31337:3" }), side: "maybe" },
        { ...placedReceipt({ id: "31337:4" }), status: "cleared" },
        null,
        "receipt",
      ])
    );

    const { result } = renderHook(() => useStoredReceipts());

    expect(result.current.map((receipt) => receipt.id)).toEqual(["31337:1"]);
  });

  it("refreshes when a receipt is recorded in this tab", () => {
    const { result } = renderHook(() => useStoredReceipts());

    expect(result.current).toEqual([]);

    act(() => {
      recordPlacedReceipt(placedReceipt({ id: "31337:1" }));
    });

    expect(result.current.map((receipt) => receipt.id)).toEqual(["31337:1"]);
  });

  it("refreshes when another tab writes to storage", () => {
    const { result } = renderHook(() => useStoredReceipts());

    act(() => {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([placedReceipt({ id: "31337:9" })])
      );
      window.dispatchEvent(new Event("storage"));
    });

    expect(result.current.map((receipt) => receipt.id)).toEqual(["31337:9"]);
  });

  it("stops listening after unmount", () => {
    const { result, unmount } = renderHook(() => useStoredReceipts());

    unmount();

    act(() => {
      recordPlacedReceipt(placedReceipt({ id: "31337:1" }));
    });

    expect(result.current).toEqual([]);
  });
});

function placedReceipt(
  overrides: Partial<PlacedPregradReceipt> = {}
): PlacedPregradReceipt {
  return {
    averagePriceCents: 52,
    collateralUsd: 100,
    createdAt: "2026-07-06T12:00:00.000Z",
    id: "31337:1",
    marketId: "31337:7",
    marketQuestion: "Will the storage tests pass?",
    priceBand: { fromProbability: 50, toProbability: 54 },
    receiptId: "1",
    shares: 192,
    side: "yes",
    status: "waiting",
    ...overrides,
  };
}

function storedReceipts(): PlacedPregradReceipt[] {
  const raw = window.localStorage.getItem(STORAGE_KEY);

  return raw ? (JSON.parse(raw) as PlacedPregradReceipt[]) : [];
}

function storedIds() {
  return storedReceipts().map((receipt) => receipt.id);
}
