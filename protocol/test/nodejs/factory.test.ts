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

describe("PopChartsFactory", async function () {
  const { viem, networkHelpers } = await network.create();

  async function deployProtocol() {
    const collateral = await viem.deployContract("MockCollateral");
    const factory = await viem.deployContract("PopChartsFactory");

    return { collateral, factory };
  }

  it("creates a bootstrap market with creator-owned config", async function () {
    const { collateral, factory } = await networkHelpers.loadFixture(deployProtocol);
    const [creator] = await viem.getWalletClients();

    const metadataHash = keccak256(stringToBytes("ipfs://popcharts/example"));
    const closeTime = BigInt(await networkHelpers.time.latest()) + 7n * 24n * 60n * 60n;

    await factory.write.createMarket([
      {
        collateral: collateral.address,
        metadataHash,
        openingProbabilityWad: (50n * WAD) / 100n,
        liquidityParameter: 5_000n * WAD,
        graduationThreshold: 40_000n * WAD,
        closeTime,
      },
    ]);

    assert.equal(await factory.read.marketCount(), 1n);

    const marketAddress = (await factory.read.marketAt([0n])) as `0x${string}`;
    const market = await viem.getContractAt("PregradMarket", marketAddress);
    const config = (await market.read.getConfig()) as MarketConfig;

    assert.equal(getAddress(config.creator), getAddress(creator.account.address));
    assert.equal(getAddress(config.collateral), getAddress(collateral.address));
    assert.equal(config.metadataHash, metadataHash);
    assert.equal(config.openingProbabilityWad, (50n * WAD) / 100n);
    assert.equal(config.liquidityParameter, 5_000n * WAD);
    assert.equal(config.graduationThreshold, 40_000n * WAD);
    assert.equal(Number(await market.read.status()), 0);
  });
});
