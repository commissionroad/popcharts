import type { Portfolio } from "@popcharts/api-client/models";
import { createContext, useContext } from "react";

/** The refund-claim button state a story wants the panel to render. */
export type RefundClaimPreview = {
  error?: string | null;
  status?: "error" | "idle" | "pending" | "success";
};

/**
 * Preview stubs for the hooks the position panel consumes. Stories drive them
 * through `PanelPreviewContext` so each story renders the real component
 * against fixture data — no wallet connection, indexer, or contract writes.
 */
/**
 * The redemption state a story wants a claim surface to render. `result`
 * mirrors the integration hook's RedemptionResult (declared structurally so
 * the mock does not pull the contract-service module into the preview build).
 */
export type RedemptionPreview = {
  error?: string | null;
  result?: {
    collateralAmount: bigint;
    outcomeAmount: bigint;
    transactionHash: `0x${string}`;
    valueWad: bigint;
  } | null;
  status?: "error" | "idle" | "pending" | "success";
};

export type PanelPreview = {
  address: string | null;
  loading: boolean;
  portfolio: Portfolio | null;
  redemption?: RedemptionPreview;
  refundClaim?: RefundClaimPreview;
};

export const PanelPreviewContext = createContext<PanelPreview>({
  address: null,
  loading: false,
  portfolio: null,
});

export function useWalletAccount() {
  return { address: useContext(PanelPreviewContext).address };
}

export function usePortfolio() {
  const preview = useContext(PanelPreviewContext);

  return {
    error: null,
    loading: preview.loading,
    portfolio: preview.portfolio,
    refresh: () => undefined,
  };
}

export function useRefundClaim() {
  const preview = useContext(PanelPreviewContext).refundClaim;

  return {
    claim: () => undefined,
    error: preview?.error ?? null,
    status: preview?.status ?? "idle",
  };
}

export function useRedemption() {
  const preview = useContext(PanelPreviewContext).redemption;

  return {
    error: preview?.error ?? null,
    redeem: () => undefined,
    redeemDraw: () => undefined,
    result: preview?.result ?? null,
    status: preview?.status ?? "idle",
  };
}
