import {
  buildMarketCreationAuthorizationTypedData,
  type MarketCreationParams,
} from "@popcharts/protocol";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { config, ZERO_ADDRESS } from "src/config";
import {
  mintPublishAuthorization,
  PUBLISH_AUTHORIZATION_TTL_SECONDS,
  readMarketCreationAuthorizerPrivateKey,
} from "src/api/services/publish-authorization";

const MANAGER = "0x00000000000000000000000000000000000000e1" as const;
const CREATOR = "0x00000000000000000000000000000000000000ab" as const;

const PARAMS: MarketCreationParams = {
  bypassAiResolution: false,
  collateral: "0x00000000000000000000000000000000000000dd",
  graduationDeadline: 1_800_000_600n,
  graduationThreshold: 2_500n * 10n ** 18n,
  liquidityParameter: 5_000n * 10n ** 18n,
  metadata: '{"question":"minted?"}',
  metadataHash: `0x${"11".repeat(32)}`,
  openingProbabilityWad: 5n * 10n ** 17n,
  resolutionTime: 1_800_001_200n,
  yesNotBefore: 1_800_001_200n,
};

describe("readMarketCreationAuthorizerPrivateKey", () => {
  it("prefers the dedicated env var over every fallback", () => {
    const key = readMarketCreationAuthorizerPrivateKey(
      {
        POPCHARTS_MARKET_CREATION_AUTHORIZER_PRIVATE_KEY: `0x${"22".repeat(32)}`,
      },
      "arcTestnet",
    );

    expect(key).toBe(`0x${"22".repeat(32)}`);
  });

  it("defaults on local networks and refuses to guess elsewhere", () => {
    // Off-local, an unset key must yield undefined — minting silently with a
    // well-known devchain key on a public network would be a signing oracle.
    expect(readMarketCreationAuthorizerPrivateKey({}, "local")).toBeDefined();
    expect(
      readMarketCreationAuthorizerPrivateKey({}, "arcTestnet"),
    ).toBeUndefined();
  });
});

describe("mintPublishAuthorization", () => {
  const originalManager = config.contracts.pregradManager;
  // The hermetic env pins NETWORK=arcTestnet so no local fallback ever fires
  // in tests; the key is supplied explicitly, like the route tests do with
  // real tokens.
  const AUTHORIZER_KEY =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

  beforeEach(() => {
    process.env.POPCHARTS_MARKET_CREATION_AUTHORIZER_PRIVATE_KEY =
      AUTHORIZER_KEY;
  });

  afterEach(() => {
    delete process.env.POPCHARTS_MARKET_CREATION_AUTHORIZER_PRIVATE_KEY;
    config.contracts.pregradManager = originalManager;
  });

  it("signs typed data the authorizer address verifies", async () => {
    config.contracts.pregradManager = MANAGER;
    const chainSeconds = 1_800_000_000n;

    const minted = await mintPublishAuthorization({
      chainSeconds,
      creator: CREATOR,
      params: PARAMS,
    });

    expect(minted).toBeDefined();
    expect(BigInt(minted!.expiry)).toBe(
      chainSeconds + PUBLISH_AUTHORIZATION_TTL_SECONDS,
    );

    // Round-trip through the same typed-data builder the contract-side test
    // in @popcharts/protocol proves on-chain: recovery to the authorizer here
    // plus that vector proof there covers the whole path.
    const authorizer = privateKeyToAccount(AUTHORIZER_KEY).address;
    const valid = await verifyTypedData({
      address: authorizer,
      signature: minted!.signature as `0x${string}`,
      ...buildMarketCreationAuthorizationTypedData({
        chainId: config.chainId,
        creator: CREATOR,
        expiry: BigInt(minted!.expiry),
        nonce: BigInt(minted!.nonce),
        params: PARAMS,
        verifyingContract: MANAGER,
      }),
    });

    expect(valid).toBe(true);
  });

  it("mints a fresh nonce per call", async () => {
    config.contracts.pregradManager = MANAGER;
    const first = await mintPublishAuthorization({
      chainSeconds: 1_800_000_000n,
      creator: CREATOR,
      params: PARAMS,
    });
    const second = await mintPublishAuthorization({
      chainSeconds: 1_800_000_000n,
      creator: CREATOR,
      params: PARAMS,
    });

    expect(first!.nonce).not.toBe(second!.nonce);
  });

  it("declines to mint when the manager address is unconfigured", async () => {
    config.contracts.pregradManager = ZERO_ADDRESS;

    const minted = await mintPublishAuthorization({
      chainSeconds: 1_800_000_000n,
      creator: CREATOR,
      params: PARAMS,
    });

    expect(minted).toBeUndefined();
  });
});
