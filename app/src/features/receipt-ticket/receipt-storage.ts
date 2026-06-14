"use client";

import { useEffect, useState } from "react";

import type { PlacedPregradReceipt } from "@/domain/pregrad-trading/receipt-quote";

const STORAGE_KEY = "popcharts:placed-pregrad-receipts:v1";

export function recordPlacedReceipt(receipt: PlacedPregradReceipt) {
  const receipts = readStoredReceipts();
  const nextReceipts = [
    receipt,
    ...receipts.filter((item) => item.id !== receipt.id),
  ].slice(0, 50);

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextReceipts));
  window.dispatchEvent(new Event("popcharts:receipts-updated"));
}

export function useStoredReceipts() {
  const [receipts, setReceipts] = useState<PlacedPregradReceipt[]>([]);

  useEffect(() => {
    function refreshReceipts() {
      setReceipts(readStoredReceipts());
    }

    refreshReceipts();
    window.addEventListener("storage", refreshReceipts);
    window.addEventListener("popcharts:receipts-updated", refreshReceipts);

    return () => {
      window.removeEventListener("storage", refreshReceipts);
      window.removeEventListener("popcharts:receipts-updated", refreshReceipts);
    };
  }, []);

  return receipts;
}

function readStoredReceipts() {
  if (typeof window === "undefined") {
    return [];
  }

  const rawValue = window.localStorage.getItem(STORAGE_KEY);

  if (!rawValue) {
    return [];
  }

  try {
    const value = JSON.parse(rawValue);

    return Array.isArray(value) ? value.filter(isStoredReceipt) : [];
  } catch {
    return [];
  }
}

function isStoredReceipt(value: unknown): value is PlacedPregradReceipt {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const receipt = value as Partial<PlacedPregradReceipt>;

  return (
    typeof receipt.id === "string" &&
    typeof receipt.marketId === "string" &&
    typeof receipt.marketQuestion === "string" &&
    typeof receipt.receiptId === "string" &&
    typeof receipt.createdAt === "string" &&
    typeof receipt.collateralUsd === "number" &&
    typeof receipt.shares === "number" &&
    (receipt.side === "yes" || receipt.side === "no") &&
    receipt.status === "waiting"
  );
}
