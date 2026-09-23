import { afterEach, describe, expect, it, vi } from "vitest";

const MANAGER = "0x0000000000000000000000000000000000000001";
const COLLATERAL = "0x0000000000000000000000000000000000000002";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getPopChartsContractConfig", () => {
  it("returns null until both contract addresses are configured", async () => {
    expect((await loadConfig({})).getPopChartsContractConfig()).toBeNull();
    expect(
      (
        await loadConfig({
          NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS: MANAGER,
        })
      ).getPopChartsContractConfig()
    ).toBeNull();
    expect(
      (
        await loadConfig({
          NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: COLLATERAL,
        })
      ).getPopChartsContractConfig()
    ).toBeNull();
  });

  it("returns null when an address is malformed", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: COLLATERAL,
      NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS: "0x123-not-an-address",
    });

    expect(config.getPopChartsContractConfig()).toBeNull();
  });

  it("checksums configured addresses", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS:
        "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
      NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS: MANAGER,
    });

    expect(config.getPopChartsContractConfig()?.collateralAddress).toBe(
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    );
  });

  it("parses and checksums the review-bond vault address when configured", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: COLLATERAL,
      NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS: MANAGER,
      NEXT_PUBLIC_POPCHARTS_REVIEW_CREDIT_VAULT_ADDRESS:
        "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    });

    expect(config.getPopChartsContractConfig()?.reviewCreditVaultAddress).toBe(
      "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
    );
  });

  it("leaves the vault address null when unset or malformed", async () => {
    const unset = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: COLLATERAL,
      NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS: MANAGER,
    });

    expect(unset.getPopChartsContractConfig()?.reviewCreditVaultAddress).toBeNull();

    const malformed = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: COLLATERAL,
      NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS: MANAGER,
      NEXT_PUBLIC_POPCHARTS_REVIEW_CREDIT_VAULT_ADDRESS: "0x123-not-an-address",
    });

    // A bad vault address never blocks the rest of the config.
    expect(malformed.getPopChartsContractConfig()).not.toBeNull();
    expect(malformed.getPopChartsContractConfig()?.reviewCreditVaultAddress).toBeNull();
  });

  it("targets Arc Testnet when the local chain flag is off", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: COLLATERAL,
      NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS: MANAGER,
    });
    const contractConfig = config.getPopChartsContractConfig();

    expect(config.localChainEnabled).toBe(false);
    expect(contractConfig?.chainEnv).toBe("arc-testnet");
    expect(contractConfig?.chainId).not.toBe(31337);
    expect(contractConfig?.nativeCurrency.symbol).not.toBe("ETH");
  });

  it("targets the local devchain defaults when the flag is on", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: COLLATERAL,
      NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN: "true",
      NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS: MANAGER,
    });
    const contractConfig = config.getPopChartsContractConfig();

    expect(contractConfig).toMatchObject({
      chainEnv: "local",
      chainId: 31337,
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
      rpcUrl: "http://127.0.0.1:8545",
    });
  });

  it("targets the Arc local chain, with USDC gas, on chain id 1337", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_CHAIN_ID: "1337",
      NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: COLLATERAL,
      NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN: "true",
      NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS: MANAGER,
    });

    // Still chainEnv "local": both devchains share the environment, and only
    // the chain id says which one — the gas currency follows the id, not the
    // env name.
    expect(config.getPopChartsContractConfig()).toMatchObject({
      chainEnv: "local",
      chainId: 1337,
      nativeCurrency: { decimals: 18, name: "USDC", symbol: "USDC" },
    });
  });

  it("prices the mock environment in ETH regardless of chain id", async () => {
    // "mock" stands in for a chain rather than naming one, so its currency
    // cannot come from the chain id the way a real local chain's does.
    const config = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_CHAIN_ENV: "mock",
      NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: COLLATERAL,
      NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS: MANAGER,
    });

    expect(config.getPopChartsContractConfig()).toMatchObject({
      chainEnv: "mock",
      nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
    });
  });

  it("keeps ETH gas for a local chain id it does not recognise", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_CHAIN_ID: "424242",
      NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS: COLLATERAL,
      NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN: "true",
      NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS: MANAGER,
    });

    expect(config.getPopChartsContractConfig()?.nativeCurrency.symbol).toBe("ETH");
  });

  it("honours a custom local chain id and RPC URL", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_CHAIN_ID: "1337",
      NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN: "true",
      NEXT_PUBLIC_POPCHARTS_RPC_URL: "http://10.0.0.5:9999",
    });

    expect(config.configuredPopChartsChainId).toBe(1337);
    expect(config.configuredPopChartsRpcUrl).toBe("http://10.0.0.5:9999");
  });

  it.each(["0", "-5", "abc", "1.5"])(
    "falls back to 31337 for invalid local chain id %s",
    async (chainId) => {
      const config = await loadConfig({
        NEXT_PUBLIC_POPCHARTS_CHAIN_ID: chainId,
        NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN: "true",
      });

      expect(config.configuredPopChartsChainId).toBe(31337);
    }
  );

  it("falls back to the local RPC default for a blank RPC URL", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN: "true",
      NEXT_PUBLIC_POPCHARTS_RPC_URL: "   ",
    });

    expect(config.configuredPopChartsRpcUrl).toBe("http://127.0.0.1:8545");
  });
});

describe("getLocalChainProfile", () => {
  it("knows both disposable devchains by exact id", async () => {
    const { getLocalChainProfile } = await loadConfig({});

    expect(getLocalChainProfile(31337).name).toBe("Hardhat Local");
    expect(getLocalChainProfile(31337).nativeCurrency.symbol).toBe("ETH");
    expect(getLocalChainProfile(1337).name).toBe("Arc Local");
    expect(getLocalChainProfile(1337).nativeCurrency.symbol).toBe("USDC");
  });

  it("never claims Arc Testnet as a local devchain", async () => {
    // arc-local (1337) and arc-testnet (5042002) share a name prefix, so a
    // prefix or substring test would quietly hand a shared network the
    // treatment reserved for a chain you can throw away. Matching on the exact
    // id is what stops that, and this is the case that proves it.
    const { getLocalChainProfile } = await loadConfig({});

    expect(getLocalChainProfile(5042002).name).toBe("Local Devchain 5042002");
    expect(getLocalChainProfile(5042002).name).not.toBe("Arc Local");
  });
});

describe("environment parsing", () => {
  it("accepts a recognised chain env", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_CHAIN_ENV: "preview",
    });

    expect(config.popChartsChainEnv).toBe("preview");
  });

  it("ignores unknown chain envs", async () => {
    const config = await loadConfig({
      NEXT_PUBLIC_POPCHARTS_CHAIN_ENV: "banana",
    });

    expect(config.popChartsChainEnv).toBe("arc-testnet");
  });

  it("only enables devchain creation on the exact flag value", async () => {
    expect(
      (await loadConfig({ NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_MODE: "devchain" }))
        .marketCreationMode
    ).toBe("devchain");
    expect(
      (await loadConfig({ NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_MODE: "DEVCHAIN" }))
        .marketCreationMode
    ).toBe("mock");
    expect((await loadConfig({})).marketCreationMode).toBe("mock");
  });

  it("defaults to wallet signing unless the server signer is requested", async () => {
    expect(
      (await loadConfig({ NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_SIGNER: "server" }))
        .marketCreationSigner
    ).toBe("server");
    expect((await loadConfig({})).marketCreationSigner).toBe("wallet");
  });
});

async function loadConfig(env: Record<string, string>) {
  vi.unstubAllEnvs();

  for (const name of [
    "NEXT_PUBLIC_POPCHARTS_CHAIN_ENV",
    "NEXT_PUBLIC_POPCHARTS_CHAIN_ID",
    "NEXT_PUBLIC_POPCHARTS_COLLATERAL_ADDRESS",
    "NEXT_PUBLIC_POPCHARTS_ENABLE_LOCAL_CHAIN",
    "NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_MODE",
    "NEXT_PUBLIC_POPCHARTS_MARKET_CREATION_SIGNER",
    "NEXT_PUBLIC_POPCHARTS_PREGRAD_MANAGER_ADDRESS",
    "NEXT_PUBLIC_POPCHARTS_REVIEW_CREDIT_VAULT_ADDRESS",
    "NEXT_PUBLIC_POPCHARTS_RPC_URL",
  ]) {
    vi.stubEnv(name, env[name] ?? "");
  }

  vi.resetModules();

  return import("./config");
}
