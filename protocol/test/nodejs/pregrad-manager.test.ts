import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { getAddress, keccak256, stringToBytes } from "viem";

const WAD = 10n ** 18n;
const DEFAULT_METADATA_URI = "data:application/json,%7B%7D";
const MarketStatus = {
  Active: 0,
  Graduating: 2,
  UnderReview: 7,
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

type MarketState = {
  status: number;
  receiptCount: bigint;
  totalEscrowed: bigint;
  path: bigint;
  yesShares: bigint;
  noShares: bigint;
  graduationStartedAt: bigint;
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

type ClearingRoot = {
  merkleRoot: `0x${string}`;
  submitter: `0x${string}`;
  snapshotHash: `0x${string}`;
  submittedAt: bigint;
  challengeDeadline: bigint;
  matchedMarketCap: bigint;
  retainedCostTotal: bigint;
  refundTotal: bigint;
  completeSetCount: bigint;
};

describe("PregradManager", async function () {
  const { viem, networkHelpers } = await network.create();

  async function deployProtocol() {
    const collateral = await viem.deployContract("MockCollateral");
    const manager = await viem.deployContract("PregradManager");
    const [owner] = await viem.getWalletClients();

    await manager.write.setTrustedCreator([getAddress(owner.account.address), true]);

    return { collateral, manager };
  }

  it("creates an under-review market with a stable market ID", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);
    const [creator] = await viem.getWalletClients();

    const metadataURI = DEFAULT_METADATA_URI;
    const metadataHash = keccak256(stringToBytes("ipfs://popcharts/example"));
    const graduationDeadline = BigInt(await networkHelpers.time.latest()) + 7n * 24n * 60n * 60n;
    const resolutionTime = graduationDeadline + 7n * 24n * 60n * 60n;

    await viem.assertions.emitWithArgs(
      manager.write.createMarket([
        {
          collateral: collateral.address,
          metadataHash,
          metadataURI,
          openingProbabilityWad: (50n * WAD) / 100n,
          liquidityParameter: 5_000n * WAD,
          graduationThreshold: 2_500n * WAD,
          graduationDeadline,
          resolutionTime,
          bypassAiResolution: false,
        },
      ]),
      manager,
      "MarketCreated",
      [
        1n,
        getAddress(creator.account.address),
        metadataHash,
        metadataURI,
        getAddress(collateral.address),
        (50n * WAD) / 100n,
        5_000n * WAD,
        2_500n * WAD,
        graduationDeadline,
        resolutionTime,
        false,
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
    assert.equal(config.graduationThreshold, 2_500n * WAD);
    assert.equal(config.graduationDeadline, graduationDeadline);
    assert.equal(config.resolutionTime, resolutionTime);
    assert.equal(config.bypassAiResolution, false);
    assert.equal(Number(state.status), MarketStatus.UnderReview);
    assert.equal(state.receiptCount, 0n);
    assert.equal(state.totalEscrowed, 0n);
    assert.equal(state.path, 0n);
    assert.equal(state.yesShares, 0n);
    assert.equal(state.noShares, 0n);
    assert.equal(state.graduationStartedAt, 0n);
  });

  it("keeps market configs isolated by market ID", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);
    const [, alice, bob] = await viem.getWalletClients();

    const firstGraduationDeadline =
      BigInt(await networkHelpers.time.latest()) + 3n * 24n * 60n * 60n;
    const secondGraduationDeadline = firstGraduationDeadline + 11n * 24n * 60n * 60n;
    const firstResolutionTime = firstGraduationDeadline + 27n * 24n * 60n * 60n;
    const secondResolutionTime = secondGraduationDeadline + 46n * 24n * 60n * 60n;
    const firstMetadataHash = keccak256(stringToBytes("ipfs://popcharts/first"));
    const secondMetadataHash = keccak256(stringToBytes("ipfs://popcharts/second"));

    await manager.write.createMarket(
      [
        {
          collateral: collateral.address,
          metadataHash: firstMetadataHash,
          metadataURI: DEFAULT_METADATA_URI,
          openingProbabilityWad: (20n * WAD) / 100n,
          liquidityParameter: 2_500n * WAD,
          graduationThreshold: 1_250n * WAD,
          graduationDeadline: firstGraduationDeadline,
          resolutionTime: firstResolutionTime,
          bypassAiResolution: false,
        },
      ],
      { account: alice.account, value: WAD },
    );

    await manager.write.createMarket(
      [
        {
          collateral: collateral.address,
          metadataHash: secondMetadataHash,
          metadataURI: DEFAULT_METADATA_URI,
          openingProbabilityWad: (80n * WAD) / 100n,
          liquidityParameter: 8_000n * WAD,
          graduationThreshold: 4_000n * WAD,
          graduationDeadline: secondGraduationDeadline,
          resolutionTime: secondResolutionTime,
          bypassAiResolution: false,
        },
      ],
      { account: bob.account, value: WAD },
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
    assert.equal(firstConfig.graduationDeadline, firstGraduationDeadline);
    assert.equal(secondConfig.graduationDeadline, secondGraduationDeadline);
    assert.equal(firstConfig.resolutionTime, firstResolutionTime);
    assert.equal(secondConfig.resolutionTime, secondResolutionTime);
  });

  it("charges public creators a fee and waives it for trusted creators", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);
    const [owner, publicCreator, feeRecipient] = await viem.getWalletClients();
    const publicClient = await viem.getPublicClient();

    const metadataHash = keccak256(stringToBytes("ipfs://popcharts/public-fee"));
    const graduationDeadline = BigInt(await networkHelpers.time.latest()) + 7n * 24n * 60n * 60n;
    const resolutionTime = graduationDeadline + 7n * 24n * 60n * 60n;

    assert.equal(await manager.read.MARKET_CREATION_FEE(), WAD);
    assert.equal(await manager.read.marketCreationFee([publicCreator.account.address]), WAD);
    assert.equal(await manager.read.marketCreationFee([owner.account.address]), 0n);

    await viem.assertions.emitWithArgs(
      manager.write.createMarket(
        [
          {
            collateral: collateral.address,
            metadataHash,
            metadataURI: DEFAULT_METADATA_URI,
            openingProbabilityWad: (50n * WAD) / 100n,
            liquidityParameter: 5_000n * WAD,
            graduationThreshold: 2_500n * WAD,
            graduationDeadline,
            resolutionTime,
            bypassAiResolution: false,
          },
        ],
        { account: publicCreator.account, value: WAD },
      ),
      manager,
      "MarketCreationFeePaid",
      [1n, getAddress(publicCreator.account.address), WAD],
    );

    assert.equal(await manager.read.collectedCreationFees(), WAD);
    assert.equal(await publicClient.getBalance({ address: manager.address }), WAD);

    await viem.assertions.revertWithCustomErrorWithArgs(
      manager.write.createMarket(
        [
          {
            collateral: collateral.address,
            metadataHash: keccak256(stringToBytes("ipfs://popcharts/no-fee")),
            metadataURI: DEFAULT_METADATA_URI,
            openingProbabilityWad: (50n * WAD) / 100n,
            liquidityParameter: 5_000n * WAD,
            graduationThreshold: 2_500n * WAD,
            graduationDeadline,
            resolutionTime,
            bypassAiResolution: false,
          },
        ],
        { account: publicCreator.account },
      ),
      manager,
      "InvalidMarketCreationFee",
      [WAD, 0n],
    );

    const feeRecipientBalanceBefore = await publicClient.getBalance({
      address: feeRecipient.account.address,
    });
    await viem.assertions.emitWithArgs(
      manager.write.withdrawCreationFees([feeRecipient.account.address, WAD]),
      manager,
      "CreationFeesWithdrawn",
      [getAddress(feeRecipient.account.address), WAD],
    );

    assert.equal(await manager.read.collectedCreationFees(), 0n);
    assert.equal(
      await publicClient.getBalance({ address: feeRecipient.account.address }),
      feeRecipientBalanceBefore + WAD,
    );
  });

  it("places a locked receipt and escrows collateral", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);
    const [, buyer] = await viem.getWalletClients();

    const metadataHash = keccak256(stringToBytes("ipfs://popcharts/receipt"));
    const graduationDeadline = BigInt(await networkHelpers.time.latest()) + 7n * 24n * 60n * 60n;
    const resolutionTime = graduationDeadline + 7n * 24n * 60n * 60n;
    const shares = 100n * WAD;

    await manager.write.createMarket([
      {
        collateral: collateral.address,
        metadataHash,
        metadataURI: DEFAULT_METADATA_URI,
        openingProbabilityWad: (50n * WAD) / 100n,
        liquidityParameter: 5_000n * WAD,
        graduationThreshold: 2_500n * WAD,
        graduationDeadline,
        resolutionTime,
        bypassAiResolution: false,
      },
    ]);
    await manager.write.approveMarket([1n]);

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

  it("starts graduation and accepts a manager-submitted clearing root", async function () {
    const { collateral, manager } = await networkHelpers.loadFixture(deployProtocol);
    const [owner, buyer] = await viem.getWalletClients();

    const metadataHash = keccak256(stringToBytes("ipfs://popcharts/graduation"));
    const graduationDeadline = BigInt(await networkHelpers.time.latest()) + 7n * 24n * 60n * 60n;
    const resolutionTime = graduationDeadline + 7n * 24n * 60n * 60n;
    const shares = 100n * WAD;
    const matchedMarketCap = 50n * WAD;
    const merkleRoot = keccak256(stringToBytes("clearing-root"));

    await manager.write.setTrustedCreator([getAddress(owner.account.address), true]);
    await manager.write.createMarket([
      {
        collateral: collateral.address,
        metadataHash,
        metadataURI: DEFAULT_METADATA_URI,
        openingProbabilityWad: (50n * WAD) / 100n,
        liquidityParameter: 5_000n * WAD,
        graduationThreshold: matchedMarketCap,
        graduationDeadline,
        resolutionTime,
        bypassAiResolution: false,
      },
    ]);
    await manager.write.approveMarket([1n]);

    await collateral.write.mint([buyer.account.address, 1_000n * WAD]);
    await collateral.write.approve([manager.address, 1_000n * WAD], {
      account: buyer.account,
    });

    const quote = (await manager.read.quoteReceipt([1n, 0, shares])) as ReceiptQuote;
    await manager.write.placeReceipt(
      [
        {
          marketId: 1n,
          side: 0,
          shares,
          maxCost: quote.cost,
        },
      ],
      { account: buyer.account },
    );

    await viem.assertions.emit(manager.write.startGraduation([1n]), manager, "GraduationStarted");

    const graduatingState = (await manager.read.getMarketState([1n])) as MarketState;
    const snapshotHash = (await manager.read.graduationSnapshotHash([1n])) as `0x${string}`;

    assert.equal(Number(graduatingState.status), MarketStatus.Graduating);
    assert.equal(graduatingState.receiptCount, 1n);
    assert.equal(graduatingState.totalEscrowed, quote.cost);
    assert.equal(graduatingState.graduationStartedAt > 0n, true);

    await viem.assertions.emitWithArgs(
      manager.write.submitClearingRoot([
        {
          marketId: 1n,
          merkleRoot,
          matchedMarketCap,
          retainedCostTotal: matchedMarketCap,
          refundTotal: quote.cost - matchedMarketCap,
          completeSetCount: matchedMarketCap,
        },
      ]),
      manager,
      "ClearingRootSubmitted",
      [
        1n,
        getAddress((await viem.getWalletClients())[0].account.address),
        merkleRoot,
        snapshotHash,
        matchedMarketCap,
        matchedMarketCap,
        quote.cost - matchedMarketCap,
        matchedMarketCap,
        (value: bigint) => value > 0n,
        (value: bigint) => value > 0n,
      ],
    );

    const clearingRoot = (await manager.read.getClearingRoot([1n])) as ClearingRoot;
    const challengePeriod = (await manager.read.CLEARING_CHALLENGE_PERIOD()) as bigint;

    assert.equal(await manager.read.hasClearingRoot([1n]), true);
    assert.equal(clearingRoot.merkleRoot, merkleRoot);
    assert.equal(clearingRoot.snapshotHash, snapshotHash);
    assert.equal(clearingRoot.matchedMarketCap, matchedMarketCap);
    assert.equal(clearingRoot.retainedCostTotal, matchedMarketCap);
    assert.equal(clearingRoot.refundTotal, quote.cost - matchedMarketCap);
    assert.equal(clearingRoot.completeSetCount, matchedMarketCap);
    assert.equal(clearingRoot.challengeDeadline, clearingRoot.submittedAt + challengePeriod);
  });
});
