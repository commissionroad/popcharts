import { type PostgradDeployment } from "../deployments/readPostgradDeployment.ts";

/**
 * Server env vars documenting a locally deployed postgrad venue. The server
 * reads the LOCAL_*-prefixed venue addresses to wire graduated markets into
 * v4 pools; the unprefixed twins keep parity with generic deployment naming.
 */
export function postgradServerEnv(
  postgrad: PostgradDeployment | null,
): Record<string, string> {
  if (postgrad === null) {
    return {};
  }

  return {
    POOL_MANAGER_ADDRESS: postgrad.poolManager,
    STATE_VIEW_ADDRESS: postgrad.stateView,
    QUOTER_ADDRESS: postgrad.quoter,
    SWAP_ROUTER_ADDRESS: postgrad.swapRouter,
    POOL_TICK_BOUNDS_ADDRESS: postgrad.poolTickBounds,
    ORDER_MANAGER_ADDRESS: postgrad.orderManager,
    BOUNDED_HOOK_ADDRESS: postgrad.boundedHook,
    POSTGRAD_ADAPTER_ADDRESS: postgrad.postgradAdapter,
    COMPLETE_SET_MARKET_ADDRESS: postgrad.marketAddress,
    COMPLETE_SET_MARKET_SYMBOL: postgrad.marketSymbol,
    COMPLETE_SET_YES_TOKEN_ADDRESS: postgrad.yesTokenAddress,
    COMPLETE_SET_NO_TOKEN_ADDRESS: postgrad.noTokenAddress,
    COMPLETE_SET_YES_POOL_ID: postgrad.yesPoolId,
    COMPLETE_SET_NO_POOL_ID: postgrad.noPoolId,
    LOCAL_POOL_MANAGER_ADDRESS: postgrad.poolManager,
    LOCAL_STATE_VIEW_ADDRESS: postgrad.stateView,
    LOCAL_QUOTER_ADDRESS: postgrad.quoter,
    LOCAL_SWAP_ROUTER_ADDRESS: postgrad.swapRouter,
    LOCAL_POOL_TICK_BOUNDS_ADDRESS: postgrad.poolTickBounds,
    LOCAL_ORDER_MANAGER_ADDRESS: postgrad.orderManager,
    LOCAL_BOUNDED_HOOK_ADDRESS: postgrad.boundedHook,
    LOCAL_POSTGRAD_ADAPTER_ADDRESS: postgrad.postgradAdapter,
    LOCAL_COMPLETE_SET_MARKET_ADDRESS: postgrad.marketAddress,
    LOCAL_COMPLETE_SET_MARKET_SYMBOL: postgrad.marketSymbol,
    LOCAL_COMPLETE_SET_YES_TOKEN_ADDRESS: postgrad.yesTokenAddress,
    LOCAL_COMPLETE_SET_NO_TOKEN_ADDRESS: postgrad.noTokenAddress,
    LOCAL_COMPLETE_SET_YES_POOL_ID: postgrad.yesPoolId,
    LOCAL_COMPLETE_SET_NO_POOL_ID: postgrad.noPoolId,
  };
}

/** The same venue env rendered as KEY=value lines for generated env files. */
export function postgradServerEnvLines(
  postgrad: PostgradDeployment | null,
): string[] {
  return Object.entries(postgradServerEnv(postgrad)).map(
    ([key, value]) => `${key}=${value}`,
  );
}

/** App env vars documenting a locally deployed postgrad venue. */
export function postgradAppEnv(
  postgrad: PostgradDeployment | null,
): Record<string, string> {
  if (postgrad === null) {
    return {};
  }

  return {
    NEXT_PUBLIC_POPCHARTS_POOL_MANAGER_ADDRESS: postgrad.poolManager,
    NEXT_PUBLIC_POPCHARTS_STATE_VIEW_ADDRESS: postgrad.stateView,
    NEXT_PUBLIC_POPCHARTS_QUOTER_ADDRESS: postgrad.quoter,
    NEXT_PUBLIC_POPCHARTS_SWAP_ROUTER_ADDRESS: postgrad.swapRouter,
    NEXT_PUBLIC_POPCHARTS_POOL_TICK_BOUNDS_ADDRESS: postgrad.poolTickBounds,
    NEXT_PUBLIC_POPCHARTS_ORDER_MANAGER_ADDRESS: postgrad.orderManager,
    NEXT_PUBLIC_POPCHARTS_BOUNDED_HOOK_ADDRESS: postgrad.boundedHook,
    NEXT_PUBLIC_POPCHARTS_POSTGRAD_ADAPTER_ADDRESS: postgrad.postgradAdapter,
    NEXT_PUBLIC_POPCHARTS_COMPLETE_SET_MARKET_ADDRESS: postgrad.marketAddress,
    NEXT_PUBLIC_POPCHARTS_COMPLETE_SET_MARKET_SYMBOL: postgrad.marketSymbol,
    NEXT_PUBLIC_POPCHARTS_COMPLETE_SET_YES_TOKEN_ADDRESS:
      postgrad.yesTokenAddress,
    NEXT_PUBLIC_POPCHARTS_COMPLETE_SET_NO_TOKEN_ADDRESS:
      postgrad.noTokenAddress,
    NEXT_PUBLIC_POPCHARTS_COMPLETE_SET_YES_POOL_ID: postgrad.yesPoolId,
    NEXT_PUBLIC_POPCHARTS_COMPLETE_SET_NO_POOL_ID: postgrad.noPoolId,
  };
}
