import type { Portfolio } from "@popcharts/api-client/models";
import { createContext, useContext } from "react";

/**
 * Preview stubs for the two data hooks the position panel consumes. Stories
 * drive them through `PanelPreviewContext` so each story renders the real
 * component against fixture data — no wallet connection or indexer.
 */
export type PanelPreview = {
  address: string | null;
  loading: boolean;
  portfolio: Portfolio | null;
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
