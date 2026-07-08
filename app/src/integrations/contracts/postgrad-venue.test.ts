import { getAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildVenuePoolKey,
  computeVenuePoolId,
  getPostgradVenueContractConfig,
} from "./postgrad-venue";

const SWAP_ROUTER = "0x00000000000000000000000000000000000000a1";
const POOL_TICK_BOUNDS = "0x00000000000000000000000000000000000000a2";
const QUOTER = "0x00000000000000000000000000000000000000a3";
const HOOK = "0x00000000000000000000000000000000000000f1" as const;
const COLLATERAL = "0x5FbDB2315678afecb367f032d93F642f64180aa3" as const;
const LOW_TOKEN = "0x0000000000000000000000000000000000000abc" as const;
const HIGH_TOKEN = "0xffffffffffffffffffffffffffffffffffffffff" as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getPostgradVenueContractConfig", () => {
  it("parses and checksums the venue addresses", () => {
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_SWAP_ROUTER_ADDRESS", SWAP_ROUTER);
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_POOL_TICK_BOUNDS_ADDRESS", POOL_TICK_BOUNDS);
    vi.stubEnv("NEXT_PUBLIC_POPCHARTS_QUOTER_ADDRESS", QUOTER);

    expect(getPostgradVenueContractConfig()).toEqual({
      poolTickBoundsAddress: getAddress(POOL_TICK_BOUNDS),
      quoterAddress: getAddress(QUOTER),
      swapRouterAddress: getAddress(SWAP_ROUTER),
    });
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

describe("buildVenuePoolKey", () => {
  it("sorts the outcome token below collateral when its address is lower", () => {
    const { key, outcomeIsCurrency0 } = buildVenuePoolKey({
      boundedHook: HOOK,
      collateral: COLLATERAL,
      outcomeToken: LOW_TOKEN,
    });

    expect(outcomeIsCurrency0).toBe(true);
    expect(key.currency0).toBe(LOW_TOKEN);
    expect(key.currency1).toBe(COLLATERAL);
    expect(key.fee).toBe(3000);
    expect(key.tickSpacing).toBe(60);
    expect(key.hooks).toBe(HOOK);
  });

  it("sorts collateral first when the outcome token address is higher", () => {
    const { key, outcomeIsCurrency0 } = buildVenuePoolKey({
      boundedHook: HOOK,
      collateral: COLLATERAL,
      outcomeToken: HIGH_TOKEN,
    });

    expect(outcomeIsCurrency0).toBe(false);
    expect(key.currency0).toBe(COLLATERAL);
    expect(key.currency1).toBe(HIGH_TOKEN);
  });
});

describe("computeVenuePoolId", () => {
  it("is deterministic and sensitive to every key field", () => {
    const { key } = buildVenuePoolKey({
      boundedHook: HOOK,
      collateral: COLLATERAL,
      outcomeToken: LOW_TOKEN,
    });

    expect(computeVenuePoolId(key)).toBe(computeVenuePoolId({ ...key }));
    expect(computeVenuePoolId(key)).not.toBe(
      computeVenuePoolId({ ...key, tickSpacing: 10 })
    );
    expect(computeVenuePoolId(key)).not.toBe(
      computeVenuePoolId({
        ...key,
        hooks: "0x00000000000000000000000000000000000000f2",
      })
    );
    expect(computeVenuePoolId(key)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});
