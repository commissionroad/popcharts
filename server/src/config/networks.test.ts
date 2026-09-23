import { describe, expect, test } from "bun:test";

import { ARC_LOCAL_CHAIN_ID } from "./arc-local";
import {
  ARC_TESTNET_CHAIN_ID,
  ARC_TESTNET_RPC_HTTP_URL,
  ARC_TESTNET_RPC_WSS_URL,
} from "./arc-testnet";
import { chainIdToNetwork, getNetworkConfig, getNetworkId } from "./networks";

const HARDHAT_CHAIN_ID = 31337;

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
      expect(getNetworkConfig().chainId).toBe(HARDHAT_CHAIN_ID);
    });
  });
});

describe("local chain selection", () => {
  test("selects the Arc local chain by id, with USDC as its gas currency", () => {
    withEnv({ CHAIN_ID: String(ARC_LOCAL_CHAIN_ID) }, () => {
      // Chain id alone has to be enough: NETWORK is unset here, exactly as it
      // is for a tool that only knows which chain it is pointed at.
      expect(getNetworkId()).toBe("local");

      const config = getNetworkConfig();

      expect(config.name).toBe("local");
      expect(config.chainId).toBe(ARC_LOCAL_CHAIN_ID);
      expect(config.chain.id).toBe(ARC_LOCAL_CHAIN_ID);
      // The gas currency is the property Hardhat's devchain could not model.
      expect(config.chain.nativeCurrency.symbol).toBe("USDC");
    });
  });

  test("treats a blank chain id as unset", () => {
    // Generated env files write bare `KEY=` lines, so an empty value must mean
    // "not configured" and not "chain id NaN".
    withEnv({ CHAIN_ID: "", LOCAL_CHAIN_ID: "", NETWORK: "local" }, () => {
      expect(getNetworkConfig().chainId).toBe(HARDHAT_CHAIN_ID);
    });
  });

  test("LOCAL_CHAIN_ID wins over the generic CHAIN_ID", () => {
    withEnv(
      {
        CHAIN_ID: String(HARDHAT_CHAIN_ID),
        LOCAL_CHAIN_ID: String(ARC_LOCAL_CHAIN_ID),
        NETWORK: "local",
      },
      () => {
        expect(getNetworkConfig().chainId).toBe(ARC_LOCAL_CHAIN_ID);
      },
    );
  });

  test("refuses a chain id that is not a local development chain", () => {
    // NETWORK=local turns on dev-only behaviour, so an unrecognized id must
    // fail loudly rather than quietly resolving to whichever chain is default.
    withEnv({ CHAIN_ID: "8453", NETWORK: "local" }, () => {
      expect(() => getNetworkConfig()).toThrow(/8453/);
    });
  });

  test("never treats Arc Testnet as a local chain", () => {
    // arc-local and arc-testnet share a name prefix and differ only in id, so
    // this is the case a prefix or substring test would silently wave through
    // — and it would hand a shared network the dev-only behaviour that
    // NETWORK=local unlocks.
    expect(chainIdToNetwork[ARC_TESTNET_CHAIN_ID]).toBe("arcTestnet");

    withEnv({ CHAIN_ID: String(ARC_TESTNET_CHAIN_ID) }, () => {
      expect(getNetworkId()).toBe("arcTestnet");
    });

    withEnv(
      { CHAIN_ID: String(ARC_TESTNET_CHAIN_ID), NETWORK: "local" },
      () => {
        expect(() => getNetworkConfig()).toThrow(
          new RegExp(String(ARC_TESTNET_CHAIN_ID)),
        );
      },
    );
  });

  test("maps every local chain id to the local network", () => {
    // chainIdToNetwork and the chain table inside networks.ts are two lists of
    // the same chains; this is what fails if a future chain lands in one only.
    for (const chainId of [HARDHAT_CHAIN_ID, ARC_LOCAL_CHAIN_ID]) {
      expect(chainIdToNetwork[chainId]).toBe("local");

      withEnv({ CHAIN_ID: String(chainId) }, () => {
        expect(getNetworkConfig().chainId).toBe(chainId);
      });
    }
  });
});

function withEnv(values: Record<string, string>, task: () => void) {
  const keys = [
    "CHAIN_ID",
    "LOCAL_CHAIN_ID",
    "NETWORK",
    "RPC_HTTP_URL",
    "RPC_WSS_URL",
    // Cleared so the hermetic test-setup.ts preload (which pins these to a
    // dead endpoint) doesn't shadow the defaults these tests probe.
    "ARC_TESTNET_RPC_HTTP_URL",
    "ARC_TESTNET_RPC_WSS_URL",
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
