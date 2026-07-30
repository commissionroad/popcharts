import type { GeneratedLocalMarket } from "@/integrations/local-market-generator/types";

/**
 * The window event the dev menu and the create form meet on. Defined once here
 * and never restated at either end: it is a coordination constant, so a copy
 * would silently stop the two agreeing.
 */
export const GENERATED_MARKET_FILL_EVENT = "popcharts:generated-market-fill";

/**
 * Announces a generated market for the create form to fill itself from. The dev
 * menu lives in the top bar and the form owns its own draft state, so the two
 * meet on a window event rather than a shared store — the same seam the test
 * pUSD mint uses, carrying a payload.
 */
export function dispatchGeneratedMarketFill(market: GeneratedLocalMarket) {
  /* v8 ignore next 3 -- SSR guard; unreachable under the jsdom test env. */
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<GeneratedLocalMarket>(GENERATED_MARKET_FILL_EVENT, {
      detail: market,
    })
  );
}

/**
 * Listens for generated markets until the returned unsubscribe is called. Only
 * the create form subscribes, and only while it is mounted — a fill announced
 * while it is off screen is simply dropped.
 */
export function subscribeToGeneratedMarketFill(
  onFill: (market: GeneratedLocalMarket) => void
) {
  /* v8 ignore next 3 -- SSR guard; unreachable under the jsdom test env. */
  if (typeof window === "undefined") {
    return () => undefined;
  }

  function handleFill(event: Event) {
    onFill((event as CustomEvent<GeneratedLocalMarket>).detail);
  }

  window.addEventListener(GENERATED_MARKET_FILL_EVENT, handleFill);

  return () => window.removeEventListener(GENERATED_MARKET_FILL_EVENT, handleFill);
}
