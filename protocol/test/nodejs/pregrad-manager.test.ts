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
  graduationTime: bigint;
  resolutionTime: bigint;
};

type MarketState = {
  status: number;
  receiptCount: bigint;
  totalEscrowed: bigint;
  path: bigint;
  yesShares: bigint;
  noShares: bigint;
  frozenAt: bigint;
};

type ReceiptQuote = {
  cost: bigint;
  rLow: bigint;
  rHigh: bigint;
};

type Receipt = {
  marketId: bigint;
  owner: `0x${string}`;
  side: number;
  shares: bigint;
  cost: bigint;
  rLow: bigint;
  rHigh: bigint;
  sequence: bigint;
  active: boolean;
};

describe("PregradManager", async function () {
  const { viem, networkHelpers } = await network.create();

  async function deployProtocol() {
    const collateral = await viem.deployContract("MockCollateral");
    const manager = await viem.deployContract("PregradManager");

    return { collateral, manager };
  }

  it("creates an active market with a stable market ID", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);
    const [creator] = await viem.getWalletClients();

    const metadataHash = keccak256(stringToBytes("ipfs://popcharts/example"));
    const graduationTime = BigInt(await networkHelpers.time.latest()) + 7n * 24n * 60n * 60n;
    const resolutionTime = graduationTime + 7n * 24n * 60n * 60n;

    await viem.assertions.emitWithArgs(
      manager.write.createMarket([
        {
          collateral: collateral.address,
          metadataHash,
          openingProbabilityWad: (50n * WAD) / 100n,
          liquidityParameter: 5_000n * WAD,
          graduationThreshold: 40_000n * WAD,
          graduationTime,
          resolutionTime,
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
        graduationTime,
        resolutionTime,
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
    assert.equal(config.graduationTime, graduationTime);
    assert.equal(config.resolutionTime, resolutionTime);
    assert.equal(Number(state.status), 0);
    assert.equal(state.receiptCount, 0n);
    assert.equal(state.totalEscrowed, 0n);
    assert.equal(state.path, 0n);
    assert.equal(state.yesShares, 0n);
    assert.equal(state.noShares, 0n);
    assert.equal(state.frozenAt, 0n);
  });

  it("keeps market configs isolated by market ID", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);
    const [, alice, bob] = await viem.getWalletClients();

    const firstGraduationTime = BigInt(await networkHelpers.time.latest()) + 3n * 24n * 60n * 60n;
    const secondGraduationTime = firstGraduationTime + 11n * 24n * 60n * 60n;
    const firstResolutionTime = firstGraduationTime + 27n * 24n * 60n * 60n;
    const secondResolutionTime = secondGraduationTime + 46n * 24n * 60n * 60n;
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
          graduationTime: firstGraduationTime,
          resolutionTime: firstResolutionTime,
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
          graduationTime: secondGraduationTime,
          resolutionTime: secondResolutionTime,
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
    assert.equal(firstConfig.graduationTime, firstGraduationTime);
    assert.equal(secondConfig.graduationTime, secondGraduationTime);
    assert.equal(firstConfig.resolutionTime, firstResolutionTime);
    assert.equal(secondConfig.resolutionTime, secondResolutionTime);
  });

  it("places a locked receipt and escrows collateral", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);
    const [, buyer] = await viem.getWalletClients();

    const metadataHash = keccak256(stringToBytes("ipfs://popcharts/receipt"));
    const graduationTime = BigInt(await networkHelpers.time.latest()) + 7n * 24n * 60n * 60n;
    const resolutionTime = graduationTime + 7n * 24n * 60n * 60n;
    const shares = 100n * WAD;

    await manager.write.createMarket([
      {
        collateral: collateral.address,
        metadataHash,
        openingProbabilityWad: (50n * WAD) / 100n,
        liquidityParameter: 5_000n * WAD,
        graduationThreshold: 40_000n * WAD,
        graduationTime,
        resolutionTime,
      },
    ]);

    await collateral.write.mint([buyer.account.address, 1_000n * WAD]);
    await collateral.write.approve([manager.address, 1_000n * WAD], {
      account: buyer.account,
    });

    const quote = (await manager.read.quoteReceipt([1n, 0, shares])) as ReceiptQuote;

    assert.equal(quote.rLow, 0n);
    assert.equal(quote.rHigh, shares);
    assert.equal(quote.cost > 50n * WAD, true);
    assert.equal(quote.cost < 51n * WAD, true);

    await viem.assertions.emitWithArgs(
      manager.write.placeReceipt(
        [
          {
            marketId: 1n,
            side: 0,
            shares,
            maxCost: quote.cost,
          },
        ],
        { account: buyer.account },
      ),
      manager,
      "ReceiptPlaced",
      [
        1n,
        1n,
        getAddress(buyer.account.address),
        0,
        shares,
        quote.cost,
        quote.rLow,
        quote.rHigh,
        1n,
      ],
    );

    const receipt = (await manager.read.getReceipt([1n])) as Receipt;
    const state = (await manager.read.getMarketState([1n])) as MarketState;

    assert.equal(await manager.read.totalReceiptCount(), 1n);
    assert.equal(await manager.read.nextReceiptId(), 2n);
    assert.equal(await manager.read.receiptExists([1n]), true);
    assert.equal(receipt.marketId, 1n);
    assert.equal(getAddress(receipt.owner), getAddress(buyer.account.address));
    assert.equal(Number(receipt.side), 0);
    assert.equal(receipt.shares, shares);
    assert.equal(receipt.cost, quote.cost);
    assert.equal(receipt.rLow, quote.rLow);
    assert.equal(receipt.rHigh, quote.rHigh);
    assert.equal(receipt.sequence, 1n);
    assert.equal(receipt.active, true);
    assert.equal(state.receiptCount, 1n);
    assert.equal(state.totalEscrowed, quote.cost);
    assert.equal(state.path, quote.rHigh);
    assert.equal(state.yesShares, shares);
    assert.equal(state.noShares, 0n);
    assert.equal(await collateral.read.balanceOf([manager.address]), quote.cost);
    assert.equal(
      await collateral.read.balanceOf([buyer.account.address]),
      1_000n * WAD - quote.cost,
    );
  });
});
