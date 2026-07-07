import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, keccak256, stringToBytes, toFunctionSelector } from "viem";

import { createLocalMarket } from "../../scripts/shared/market/createLocalMarket.js";
import {
  buildLocalSmokeMarketMetadata,
  hashMarketMetadata,
  parseMarketMetadata,
  serializeMarketMetadata,
  type MarketMetadata,
} from "../../scripts/shared/market/localMarketMetadata.js";
import {
  DEFAULT_GRADUATION_SECONDS,
  DEFAULT_RESOLUTION_SECONDS,
  readMarketTiming,
  resolveDeadlineAnchor,
} from "../../scripts/shared/market/localMarketTiming.js";

const WAD = 10n ** 18n;
const HOUR_SECONDS = 60n * 60n;
const LOCAL_TIMING = {
  graduationSeconds: HOUR_SECONDS,
  resolutionSeconds: 2n * HOUR_SECONDS,
};

// The exact metadata shape the root local-create-market wrapper passes through
// the LOCAL_MARKET_METADATA env var (scripts/local-create-market.ts). If
// parseMarketMetadata stops accepting this, `just local-create-market` breaks.
const WRAPPER_METADATA_PAYLOAD = {
  version: 1,
  question: "Will BTC/USD be higher than $63,000 at 2026-07-07T17:00:00Z?",
  description: "Auto-generated local-dev market using the live BTC/USD spot price.",
  category: "Crypto",
  resolutionCriteria: "Resolve YES if the linked source reports a higher price. Ties resolve NO.",
  resolutionUrl: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd",
  createdAt: "2026-07-07T15:00:00.000Z",
} as const;

type MarketConfig = {
  collateral: `0x${string}`;
  creator: `0x${string}`;
  metadataHash: `0x${string}`;
  openingProbabilityWad: bigint;
  liquidityParameter: bigint;
  graduationThreshold: bigint;
  graduationDeadline: bigint;
  resolutionTime: bigint;
  bypassAiResolution: boolean;
};

describe("create-local-market helper", async function () {
  const { viem, networkHelpers } = await network.create();

  async function deployProtocol() {
    const collateral = await viem.deployContract("MockCollateral");
    const manager = await viem.deployContract("PregradManager");

    return { collateral, manager };
  }

  function wrapperMetadata(): MarketMetadata {
    return parseMarketMetadata(WRAPPER_METADATA_PAYLOAD);
  }

  it("creates a market through the current PregradManager ABI", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);
    const [creator] = await viem.getWalletClients();
    const metadata = wrapperMetadata();

    const marketCountBefore = (await manager.read.marketCount()) as bigint;
    const summary = await createLocalMarket({
      collateralAddress: collateral.address,
      managerAddress: manager.address,
      metadata,
      timing: LOCAL_TIMING,
      viem,
    });

    assert.equal(await manager.read.marketCount(), marketCountBefore + 1n);
    assert.equal(summary.marketId, (marketCountBefore + 1n).toString());
    assert.equal(summary.chainId, 31337);
    assert.equal(getAddress(summary.creator), getAddress(creator.account.address));
    assert.equal(getAddress(summary.pregradManagerAddress), getAddress(manager.address));
    assert.equal(getAddress(summary.collateralAddress), getAddress(collateral.address));
    assert.equal(summary.metadata, serializeMarketMetadata(metadata));
    assert.equal(summary.metadataHash, keccak256(stringToBytes(summary.metadata)));

    const config = (await manager.read.getMarketConfig([BigInt(summary.marketId)])) as MarketConfig;

    assert.equal(config.metadataHash, summary.metadataHash);
    assert.equal(getAddress(config.collateral), getAddress(collateral.address));
    assert.equal(config.graduationDeadline, BigInt(summary.graduationDeadline));
    assert.equal(config.resolutionTime, BigInt(summary.resolutionTime));
    assert.equal(
      config.resolutionTime - config.graduationDeadline,
      LOCAL_TIMING.resolutionSeconds - LOCAL_TIMING.graduationSeconds,
    );
    assert.equal(config.bypassAiResolution, false);
  });

  it("pays the public market creation fee the contract quotes", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);
    const [creator] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const fee = (await manager.read.marketCreationFee([creator.account.address])) as bigint;
    assert.equal(fee, WAD);

    await createLocalMarket({
      collateralAddress: collateral.address,
      managerAddress: manager.address,
      metadata: wrapperMetadata(),
      timing: LOCAL_TIMING,
      viem,
    });

    assert.equal(await publicClient.getBalance({ address: manager.address }), fee);
  });

  it("anchors deadlines to wall clock when the chain is idle", async function () {
    // Regression: an idle local chain's latest block lags wall clock. Deadlines
    // computed from the stale block timestamp land in the past once the
    // creation transaction mines at wall-clock time, and the contract reverts
    // with InvalidGraduationDeadline.
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);
    const publicClient = await viem.getPublicClient();

    const staleBlock = await publicClient.getBlock();
    const nowSeconds = staleBlock.timestamp + 3n * HOUR_SECONDS;

    const summary = await createLocalMarket({
      collateralAddress: collateral.address,
      managerAddress: manager.address,
      metadata: wrapperMetadata(),
      nowSeconds,
      timing: LOCAL_TIMING,
      viem,
    });

    assert.equal(BigInt(summary.graduationDeadline), nowSeconds + LOCAL_TIMING.graduationSeconds);
    assert.equal(BigInt(summary.resolutionTime), nowSeconds + LOCAL_TIMING.resolutionSeconds);
  });

  it("anchors deadlines to chain time when the chain is ahead of wall clock", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);

    await networkHelpers.time.increase(30 * 24 * 60 * 60);
    const chainTime = BigInt(await networkHelpers.time.latest());
    const nowSeconds = chainTime - 30n * 24n * HOUR_SECONDS;

    const summary = await createLocalMarket({
      collateralAddress: collateral.address,
      managerAddress: manager.address,
      metadata: wrapperMetadata(),
      nowSeconds,
      timing: LOCAL_TIMING,
      viem,
    });

    assert.equal(BigInt(summary.graduationDeadline), chainTime + LOCAL_TIMING.graduationSeconds);
    assert.equal(BigInt(summary.resolutionTime), chainTime + LOCAL_TIMING.resolutionSeconds);
  });

  it("emits the summary fields the root orchestrators parse", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);

    const summary = await createLocalMarket({
      collateralAddress: collateral.address,
      managerAddress: manager.address,
      metadata: wrapperMetadata(),
      timing: LOCAL_TIMING,
      viem,
    });

    // scripts/local-create-market.ts and scripts/local-chain-smoke.ts parse
    // this object back from the LOCAL_CHAIN_SMOKE_MARKET stdout line. Removing
    // or renaming a key is a breaking change to that contract.
    assert.deepEqual(Object.keys(summary).sort(), [
      "blockNumber",
      "chainId",
      "collateralAddress",
      "creator",
      "graduationDeadline",
      "marketId",
      "metadata",
      "metadataHash",
      "pregradManagerAddress",
      "resolutionTime",
      "transactionHash",
    ]);
    // Every value must survive JSON.stringify (no bigints).
    assert.equal(JSON.parse(JSON.stringify(summary)).marketId, summary.marketId);
  });

  it("keeps marketCount() at the selector the root wrapper probes", function () {
    // scripts/local-create-market.ts validates the deployment by eth_call-ing
    // this hardcoded selector before creating a market. Renaming or removing
    // PregradManager.marketCount() breaks that probe.
    assert.equal(toFunctionSelector("function marketCount() view returns (uint256)"), "0xec979082");
  });

  describe("market metadata", function () {
    it("accepts the wrapper-generated payload and round-trips it", function () {
      const metadata = parseMarketMetadata(WRAPPER_METADATA_PAYLOAD);

      assert.deepEqual(
        parseMarketMetadata(JSON.parse(serializeMarketMetadata(metadata))),
        metadata,
      );
    });

    it("serializes with a stable key order so hashes are reproducible", function () {
      const metadata = parseMarketMetadata(WRAPPER_METADATA_PAYLOAD);

      assert.equal(
        serializeMarketMetadata(metadata),
        '{"version":1,' +
          `"question":${JSON.stringify(WRAPPER_METADATA_PAYLOAD.question)},` +
          `"description":${JSON.stringify(WRAPPER_METADATA_PAYLOAD.description)},` +
          `"category":"Crypto",` +
          `"resolutionCriteria":${JSON.stringify(WRAPPER_METADATA_PAYLOAD.resolutionCriteria)},` +
          `"resolutionUrl":${JSON.stringify(WRAPPER_METADATA_PAYLOAD.resolutionUrl)},` +
          `"createdAt":"2026-07-07T15:00:00.000Z"}`,
      );
      assert.equal(
        hashMarketMetadata(metadata),
        keccak256(stringToBytes(serializeMarketMetadata(metadata))),
      );
    });

    it("rejects payloads the contract flow cannot store", function () {
      assert.throws(() => parseMarketMetadata(null), /JSON object/);
      assert.throws(
        () => parseMarketMetadata({ ...WRAPPER_METADATA_PAYLOAD, version: 2 }),
        /version/,
      );
      assert.throws(
        () => parseMarketMetadata({ ...WRAPPER_METADATA_PAYLOAD, question: undefined }),
        /question/,
      );
      assert.throws(
        () => parseMarketMetadata({ ...WRAPPER_METADATA_PAYLOAD, resolutionSources: [42] }),
        /resolutionSources/,
      );
    });

    it("builds a valid default smoke payload", function () {
      const metadata = buildLocalSmokeMarketMetadata();

      assert.deepEqual(
        parseMarketMetadata(JSON.parse(serializeMarketMetadata(metadata))),
        metadata,
      );
    });
  });

  describe("market timing", function () {
    it("defaults to the seven and fourteen day windows", function () {
      assert.deepEqual(readMarketTiming({}), {
        graduationSeconds: DEFAULT_GRADUATION_SECONDS,
        resolutionSeconds: DEFAULT_RESOLUTION_SECONDS,
      });
    });

    it("reads the wrapper-provided env overrides", function () {
      assert.deepEqual(
        readMarketTiming({
          LOCAL_MARKET_GRADUATION_SECONDS: "3600",
          LOCAL_MARKET_RESOLUTION_SECONDS: "7200",
        }),
        LOCAL_TIMING,
      );
    });

    it("rejects invalid timing", function () {
      assert.throws(
        () =>
          readMarketTiming({
            LOCAL_MARKET_GRADUATION_SECONDS: "7200",
            LOCAL_MARKET_RESOLUTION_SECONDS: "3600",
          }),
        /must be greater/,
      );
      assert.throws(
        () => readMarketTiming({ LOCAL_MARKET_GRADUATION_SECONDS: "0" }),
        /positive integer/,
      );
      assert.throws(
        () => readMarketTiming({ LOCAL_MARKET_RESOLUTION_SECONDS: "2.5" }),
        /positive integer/,
      );
    });

    it("anchors to whichever clock is further along", function () {
      assert.equal(resolveDeadlineAnchor(100n, 200n), 200n);
      assert.equal(resolveDeadlineAnchor(300n, 200n), 300n);
      assert.equal(resolveDeadlineAnchor(200n, 200n), 200n);
    });
  });
});
