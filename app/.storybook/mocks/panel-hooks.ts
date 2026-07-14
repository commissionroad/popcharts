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
export type PanelPreview = {
  address: string | null;
  loading: boolean;
  portfolio: Portfolio | null;
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
