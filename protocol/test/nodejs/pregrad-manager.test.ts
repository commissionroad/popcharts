import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, keccak256, stringToBytes } from "viem";

const WAD = 10n ** 18n;

type MarketConfig = {
  collateral: `0x${string}`;
  creator: `0x${string}`;
  metadataHash: `0x${string}`;
  openingProbabilityWad: bigint;
  liquidityParameter: bigint;
  graduationThreshold: bigint;
  closeTime: bigint;
};

type MarketState = {
  status: number;
  receiptCount: bigint;
  totalEscrowed: bigint;
  frozenAt: bigint;
};

describe("PregradManager", async function () {
  const { viem, networkHelpers } = await network.create();

  async function deployProtocol() {
    const collateral = await viem.deployContract("MockCollateral");
    const manager = await viem.deployContract("PregradManager");

    return { collateral, manager };
  }

  it("creates a bootstrap market with a stable market ID", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);
    const [creator] = await viem.getWalletClients();

    const metadataHash = keccak256(stringToBytes("ipfs://popcharts/example"));
    const closeTime = BigInt(await networkHelpers.time.latest()) + 7n * 24n * 60n * 60n;

    await viem.assertions.emitWithArgs(
      manager.write.createMarket([
        {
          collateral: collateral.address,
          metadataHash,
          openingProbabilityWad: (50n * WAD) / 100n,
          liquidityParameter: 5_000n * WAD,
          graduationThreshold: 40_000n * WAD,
          closeTime,
        },
      ]),
      manager,
      "MarketCreated",
      [
        1n,
        getAddress(creator.account.address),
        metadataHash,
        getAddress(collateral.address),
        (50n * WAD) / 100n,
        5_000n * WAD,
        40_000n * WAD,
        closeTime,
      ],
    );

    assert.equal(await manager.read.marketCount(), 1n);
    assert.equal(await manager.read.nextMarketId(), 2n);
    assert.equal(await manager.read.marketExists([1n]), true);
    assert.equal(await manager.read.marketExists([2n]), false);

    const config = (await manager.read.getMarketConfig([1n])) as MarketConfig;
    const state = (await manager.read.getMarketState([1n])) as MarketState;

    assert.equal(getAddress(config.creator), getAddress(creator.account.address));
    assert.equal(getAddress(config.collateral), getAddress(collateral.address));
    assert.equal(config.metadataHash, metadataHash);
    assert.equal(config.openingProbabilityWad, (50n * WAD) / 100n);
    assert.equal(config.liquidityParameter, 5_000n * WAD);
    assert.equal(config.graduationThreshold, 40_000n * WAD);
    assert.equal(config.closeTime, closeTime);
    assert.equal(Number(state.status), 0);
    assert.equal(state.receiptCount, 0n);
    assert.equal(state.totalEscrowed, 0n);
    assert.equal(state.frozenAt, 0n);
  });

  it("keeps market configs isolated by market ID", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);
    const [, alice, bob] = await viem.getWalletClients();

    const firstCloseTime = BigInt(await networkHelpers.time.latest()) + 3n * 24n * 60n * 60n;
    const secondCloseTime = firstCloseTime + 11n * 24n * 60n * 60n;
    const firstMetadataHash = keccak256(stringToBytes("ipfs://popcharts/first"));
    const secondMetadataHash = keccak256(stringToBytes("ipfs://popcharts/second"));

    await manager.write.createMarket(
      [
        {
          collateral: collateral.address,
          metadataHash: firstMetadataHash,
          openingProbabilityWad: (20n * WAD) / 100n,
          liquidityParameter: 2_500n * WAD,
          graduationThreshold: 25_000n * WAD,
          closeTime: firstCloseTime,
        },
      ],
      { account: alice.account },
    );

    await manager.write.createMarket(
      [
        {
          collateral: collateral.address,
          metadataHash: secondMetadataHash,
          openingProbabilityWad: (80n * WAD) / 100n,
          liquidityParameter: 8_000n * WAD,
          graduationThreshold: 100_000n * WAD,
          closeTime: secondCloseTime,
        },
      ],
      { account: bob.account },
    );

    const firstConfig = (await manager.read.getMarketConfig([1n])) as MarketConfig;
    const secondConfig = (await manager.read.getMarketConfig([2n])) as MarketConfig;

    assert.equal(await manager.read.marketCount(), 2n);
    assert.equal(getAddress(firstConfig.creator), getAddress(alice.account.address));
    assert.equal(getAddress(secondConfig.creator), getAddress(bob.account.address));
    assert.equal(firstConfig.metadataHash, firstMetadataHash);
    assert.equal(secondConfig.metadataHash, secondMetadataHash);
    assert.equal(firstConfig.openingProbabilityWad, (20n * WAD) / 100n);
    assert.equal(secondConfig.openingProbabilityWad, (80n * WAD) / 100n);
    assert.equal(firstConfig.closeTime, firstCloseTime);
    assert.equal(secondConfig.closeTime, secondCloseTime);
  });
});
