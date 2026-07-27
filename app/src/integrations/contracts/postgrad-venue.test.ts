import { getAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

// Pool-key and pool-id derivation belongs to @popcharts/protocol, so its
// tests live beside it in protocol/test/nodejs/outcome-pool-key.test.ts.
import { getPostgradVenueContractConfig } from "./postgrad-venue";

const SWAP_ROUTER = "0x00000000000000000000000000000000000000a1";
const POOL_TICK_BOUNDS = "0x00000000000000000000000000000000000000a2";
const QUOTER = "0x00000000000000000000000000000000000000a3";
const ORDER_MANAGER = "0x00000000000000000000000000000000000000a4";
const STATE_VIEW = "0x00000000000000000000000000000000000000a5";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getPostgradVenueContractConfig", () => {
  it("parses and checksums the venue addresses", () => {
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_SWAP_ROUTER_ADDRESS", SWAP_ROUTER);
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_POOL_TICK_BOUNDS_ADDRESS", POOL_TICK_BOUNDS);
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_QUOTER_ADDRESS", QUOTER);
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_ORDER_MANAGER_ADDRESS", ORDER_MANAGER);
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_STATE_VIEW_ADDRESS", STATE_VIEW);

    expect(getPostgradVenueContractConfig()).toEqual({
      orderManagerAddress: getAddress(ORDER_MANAGER),
      poolTickBoundsAddress: getAddress(POOL_TICK_BOUNDS),
      quoterAddress: getAddress(QUOTER),
      stateViewAddress: getAddress(STATE_VIEW),
      swapRouterAddress: getAddress(SWAP_ROUTER),
    });
  });

  it("treats the order manager and state view as optional", () => {
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_SWAP_ROUTER_ADDRESS", SWAP_ROUTER);
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_POOL_TICK_BOUNDS_ADDRESS", POOL_TICK_BOUNDS);

    const config = getPostgradVenueContractConfig();

    expect(config?.orderManagerAddress).toBeNull();
    expect(config?.stateViewAddress).toBeNull();
  });

  it("treats a missing quoter as optional", () => {
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_SWAP_ROUTER_ADDRESS", SWAP_ROUTER);
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_POOL_TICK_BOUNDS_ADDRESS", POOL_TICK_BOUNDS);

    expect(getPostgradVenueContractConfig()?.quoterAddress).toBeNull();
  });

  it("returns null without a swap router", () => {
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_POOL_TICK_BOUNDS_ADDRESS", POOL_TICK_BOUNDS);

    expect(getPostgradVenueContractConfig()).toBeNull();
  });

  it("returns null without a tick bounds registry", () => {
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_SWAP_ROUTER_ADDRESS", SWAP_ROUTER);

    expect(getPostgradVenueContractConfig()).toBeNull();
  });

  it("rejects malformed addresses", () => {
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_SWAP_ROUTER_ADDRESS", "not-an-address");
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_POOL_TICK_BOUNDS_ADDRESS", POOL_TICK_BOUNDS);

    expect(getPostgradVenueContractConfig()).toBeNull();
  });
});
