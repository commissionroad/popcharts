import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("with the local chain enabled", () => {
  it("defaults to the local Hardhat chain and keeps Arc Testnet supported", async () => {
    const chains = await loadChains({
      NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN: "true",
    });

    expect(chains.defaultEvmChain.id).toBe(31337);
    expect(chains.defaultEvmChain.name).toBe("Hardhat Local");
    expect(chains.supportedWalletChains.map((chain) => chain.id)).toEqual([
      31337,
      chains.arcTestnet.id,
    ]);
  });

  it("names a non-default local chain by its id", async () => {
    const chains = await loadChains({
      NEXT_PUBLIC_POPCHARTS_CHAIN_ID: "1337",
      NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN: "true",
    });

    expect(chains.defaultEvmChain.id).toBe(1337);
    expect(chains.defaultEvmChain.name).toBe("Local Devchain 1337");
  });

  it("serves the configured RPC URL only for the configured chain", async () => {
    const chains = await loadChains({
      NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN: "true",
      NEXT_PUBLIC_POPCHARTS_RPC_URL: "http://10.0.0.5:9999",
    });

    expect(chains.getWalletRpcUrlForChain(31337)).toBe("http://10.0.0.5:9999");
    expect(chains.getWalletRpcUrlForChain(1)).toBeUndefined();
  });
});

describe("with the local chain disabled", () => {
  it("supports only Arc Testnet", async () => {
    const chains = await loadChains({});

    expect(chains.defaultEvmChain.id).toBe(chains.arcTestnet.id);
    expect(chains.supportedWalletChains).toHaveLength(1);
    expect(chains.isSupportedEvmChainId(31337)).toBe(false);
  });
});

describe("chain lookups", () => {
  it("finds supported chains by id", async () => {
    const chains = await loadChains({
      NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN: "true",
    });

    expect(chains.findSupportedEvmChain(31337)?.name).toBe("Hardhat Local");
    expect(chains.findSupportedEvmChain(chains.arcTestnet.id)?.id).toBe(
      chains.arcTestnet.id
    );
  });

  it("treats missing and unknown chain ids as unsupported", async () => {
    const chains = await loadChains({
      NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN: "true",
    });

    expect(chains.findSupportedEvmChain(null)).toBeUndefined();
    expect(chains.findSupportedEvmChain(undefined)).toBeUndefined();
    expect(chains.findSupportedEvmChain(999_999)).toBeUndefined();
    expect(chains.isSupportedEvmChainId(null)).toBe(false);
    expect(chains.isSupportedEvmChainId(999_999)).toBe(false);
    expect(chains.isSupportedEvmChainId(31337)).toBe(true);
  });
});

async function loadChains(env: Record<string, string>) {
  vi.unstubAllEnvs();

  for (const name of [
    "NEXT_PUBLIC_POPCHARTS_CHAIN_ID",
    "NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN",
    "NEXT_PUBLIC_POPCHARTS_RPC_URL",
  ]) {
    vi.stubEnv(name, env[name] ?? "");
  }

  vi.resetModules();

  return import("./chains");
}
