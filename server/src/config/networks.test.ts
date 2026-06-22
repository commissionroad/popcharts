import { describe, expect, test } from "bun:test";

import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_HTTP_URL,
  ARC_TESTNET_RPC_WSS_URL,
} from "./arc-testnet";
import { getNetworkConfig, getNetworkId } from "./networks";

describe("network config", () => {
  test("defaults to Arc Testnet", () => {
    withEnv({}, () => {
      expect(getNetworkId()).toBe("arcTestnet");

      const config = getNetworkConfig();

      expect(config.name).toBe("arcTestnet");
      expect(config.chainId).toBe(ARC_TESTNET_CHAIN_ID);
      expect(config.rpcHttpUrl).toBe(ARC_TESTNET_RPC_HTTP_URL);
      expect(config.rpcWssUrl).toBe(ARC_TESTNET_RPC_WSS_URL);
    });
  });

  test("does not let generic RPC env values replace Arc Testnet defaults", () => {
    withEnv(
      {
        RPC_HTTP_URL: "https://mainnet.base.org",
        RPC_WSS_URL: "wss://example.invalid/base",
      },
      () => {
        const config = getNetworkConfig("arcTestnet");

        expect(config.rpcHttpUrl).toBe(ARC_TESTNET_RPC_HTTP_URL);
        expect(config.rpcWssUrl).toBe(ARC_TESTNET_RPC_WSS_URL);
      },
    );
  });

  test("keeps local Hardhat available only when selected", () => {
    withEnv({ NETWORK: "local" }, () => {
      expect(getNetworkId()).toBe("local");
      expect(getNetworkConfig().chainId).toBe(31337);
    });
  });
});

function withEnv(values: Record<string, string>, task: () => void) {
  const keys = [
    "CHAIN_ID",
    "NETWORK",
    "RPC_HTTP_URL",
    "RPC_WSS_URL",
    ...Object.keys(values),
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  for (const key of keys) {
    delete process.env[key];
  }

  Object.assign(process.env, values);

  try {
    task();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}
