// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {MockCollateral} from "../../contracts/mocks/MockCollateral.sol";
import {MockFeeCollateral} from "../../contracts/mocks/MockFeeCollateral.sol";
import {PregradManager} from "../../contracts/PregradManager.sol";
import {LmsrMath} from "../../contracts/libraries/LmsrMath.sol";
import {MarketTypes} from "../../contracts/types/MarketTypes.sol";

contract PregradManagerTest is Test {
  uint256 private constant WAD = 1e18;

  event MarketCreated(
    uint256 indexed marketId,
    address indexed creator,
    bytes32 indexed metadataHash,
    address collateral,
    uint256 openingProbabilityWad,
    uint256 liquidityParameter,
    uint256 graduationThreshold,
    uint64 graduationTime,
    uint64 resolutionTime
  );

  event ReceiptPlaced(
    uint256 indexed receiptId,
    uint256 indexed marketId,
    address indexed owner,
    MarketTypes.Side side,
    uint256 shares,
    uint256 cost,
    int256 rLow,
    int256 rHigh,
    uint64 sequence
  );

  MockCollateral private collateral;
  PregradManager private manager;

  function setUp() public {
    collateral = new MockCollateral();
    manager = new PregradManager();
  }

  function test_CreateMarketStoresActiveConfigAndEmitsEvent() public {
    bytes32 metadataHash = keccak256("ipfs://popcharts/example");
    MarketTypes.CreateMarketParams memory params = _defaultMarketParams(metadataHash);

    vm.expectEmit(true, true, true, true, address(manager));
    emit MarketCreated(
      1,
      address(this),
      metadataHash,
      address(collateral),
      params.openingProbabilityWad,
      params.liquidityParameter,
      params.graduationThreshold,
      params.graduationTime,
      params.resolutionTime
    );

    uint256 marketId = manager.createMarket(params);

    MarketTypes.MarketConfig memory config = manager.getMarketConfig(marketId);
    MarketTypes.MarketState memory state = manager.getMarketState(marketId);

    assertEq(marketId, 1);
    assertEq(manager.nextMarketId(), 2);
    assertEq(manager.marketCount(), 1);
    assertTrue(manager.marketExists(marketId));
    assertEq(config.collateral, address(collateral));
    assertEq(config.creator, address(this));
    assertEq(config.metadataHash, metadataHash);
    assertEq(config.openingProbabilityWad, (50 * WAD) / 100);
    assertEq(config.liquidityParameter, 5_000 * WAD);
    assertEq(config.graduationThreshold, 40_000 * WAD);
    assertEq(config.graduationTime, params.graduationTime);
    assertEq(config.resolutionTime, params.resolutionTime);
    assertEq(uint256(state.status), uint256(MarketTypes.MarketStatus.Active));
    assertEq(state.receiptCount, 0);
    assertEq(state.totalEscrowed, 0);
    assertEq(state.path, int256(0));
    assertEq(state.yesShares, 0);
    assertEq(state.noShares, 0);
    assertEq(state.frozenAt, 0);
  }

  function test_CreateMarketIdsIncrementAndMarketsAreIsolated() public {
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bytes32 aliceMetadataHash = keccak256("ipfs://popcharts/alice");
    bytes32 bobMetadataHash = keccak256("ipfs://popcharts/bob");

    vm.prank(alice);
    uint256 aliceMarketId = manager.createMarket(
      MarketTypes.CreateMarketParams({
        collateral: address(collateral),
        metadataHash: aliceMetadataHash,
        openingProbabilityWad: (20 * WAD) / 100,
        liquidityParameter: 2_500 * WAD,
        graduationThreshold: 25_000 * WAD,
        graduationTime: uint64(block.timestamp + 3 days),
        resolutionTime: uint64(block.timestamp + 30 days)
      })
    );

    vm.prank(bob);
    uint256 bobMarketId = manager.createMarket(
      MarketTypes.CreateMarketParams({
        collateral: address(collateral),
        metadataHash: bobMetadataHash,
        openingProbabilityWad: (80 * WAD) / 100,
        liquidityParameter: 8_000 * WAD,
        graduationThreshold: 100_000 * WAD,
        graduationTime: uint64(block.timestamp + 14 days),
        resolutionTime: uint64(block.timestamp + 60 days)
      })
    );

    MarketTypes.MarketConfig memory aliceConfig = manager.getMarketConfig(aliceMarketId);
    MarketTypes.MarketConfig memory bobConfig = manager.getMarketConfig(bobMarketId);

    assertEq(aliceMarketId, 1);
    assertEq(bobMarketId, 2);
    assertEq(manager.marketCount(), 2);
    assertEq(aliceConfig.creator, alice);
    assertEq(bobConfig.creator, bob);
    assertEq(aliceConfig.metadataHash, aliceMetadataHash);
    assertEq(bobConfig.metadataHash, bobMetadataHash);
    assertEq(aliceConfig.openingProbabilityWad, (20 * WAD) / 100);
    assertEq(bobConfig.openingProbabilityWad, (80 * WAD) / 100);
  }

  function test_PlaceReceiptEmitsEventAndEscrowsCollateral() public {
    address buyer = makeAddr("buyer");
    uint256 marketId = _createDefaultMarket();
    uint256 shares = 100 * WAD;

    _fundAndApprove(buyer, 1_000 * WAD);
    MarketTypes.ReceiptQuote memory quote = manager.quoteReceipt(
      marketId,
      MarketTypes.Side.Yes,
      shares
    );

    assertGt(quote.cost, 50 * WAD);
    assertLt(quote.cost, 51 * WAD);
    assertEq(quote.rLow, int256(0));
    assertEq(quote.rHigh, int256(shares));

    vm.expectEmit(true, true, true, true, address(manager));
    emit ReceiptPlaced(
      1,
      marketId,
      buyer,
      MarketTypes.Side.Yes,
      shares,
      quote.cost,
      quote.rLow,
      quote.rHigh,
      1
    );

    vm.prank(buyer);
    uint256 receiptId = manager.placeReceipt(
      MarketTypes.PlaceReceiptParams({
        marketId: marketId,
        side: MarketTypes.Side.Yes,
        shares: shares,
        maxCost: quote.cost
      })
    );

    MarketTypes.MarketState memory state = manager.getMarketState(marketId);

    assertEq(receiptId, 1);
    assertEq(manager.totalReceiptCount(), 1);
    assertEq(state.totalEscrowed, quote.cost);
    assertEq(collateral.balanceOf(address(manager)), quote.cost);
    assertEq(collateral.balanceOf(buyer), 1_000 * WAD - quote.cost);
  }

  function test_PlaceReceiptStoresReceiptAndUpdatesMarketState() public {
    address buyer = makeAddr("buyer");
    uint256 marketId = _createDefaultMarket();
    uint256 shares = 100 * WAD;

    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, MarketTypes.ReceiptQuote memory quote) = _placeReceiptAs(
      buyer,
      marketId,
      MarketTypes.Side.Yes,
      shares
    );

    MarketTypes.Receipt memory receipt = manager.getReceipt(receiptId);
    MarketTypes.MarketState memory state = manager.getMarketState(marketId);

    assertEq(manager.nextReceiptId(), 2);
    assertTrue(manager.receiptExists(receiptId));
    assertEq(receipt.marketId, marketId);
    assertEq(receipt.owner, buyer);
    assertEq(uint256(receipt.side), uint256(MarketTypes.Side.Yes));
    assertEq(receipt.shares, shares);
    assertEq(receipt.cost, quote.cost);
    assertEq(receipt.rLow, quote.rLow);
    assertEq(receipt.rHigh, quote.rHigh);
    assertEq(receipt.sequence, 1);
    assertTrue(receipt.active);
    assertEq(state.receiptCount, 1);
    assertEq(state.totalEscrowed, quote.cost);
    assertEq(state.path, quote.rHigh);
    assertEq(state.yesShares, shares);
    assertEq(state.noShares, 0);
  }

  function test_PlaceReceiptIdsIncrementAndMarketsAreIsolated() public {
    address buyer = makeAddr("buyer");
    uint256 firstMarketId = _createDefaultMarket();
    uint256 secondMarketId = _createSecondDefaultMarket();

    uint256 firstShares = 50 * WAD;
    uint256 secondShares = 25 * WAD;
    _fundAndApprove(buyer, 1_000 * WAD);

    (uint256 firstReceiptId, MarketTypes.ReceiptQuote memory firstQuote) = _placeReceiptAs(
      buyer,
      firstMarketId,
      MarketTypes.Side.Yes,
      firstShares
    );
    (uint256 secondReceiptId, MarketTypes.ReceiptQuote memory secondQuote) = _placeReceiptAs(
      buyer,
      secondMarketId,
      MarketTypes.Side.No,
      secondShares
    );

    MarketTypes.Receipt memory firstReceipt = manager.getReceipt(firstReceiptId);
    MarketTypes.Receipt memory secondReceipt = manager.getReceipt(secondReceiptId);
    MarketTypes.MarketState memory firstState = manager.getMarketState(firstMarketId);
    MarketTypes.MarketState memory secondState = manager.getMarketState(secondMarketId);

    assertEq(firstReceiptId, 1);
    assertEq(secondReceiptId, 2);
    assertEq(firstReceipt.sequence, 1);
    assertEq(secondReceipt.sequence, 1);
    assertEq(firstState.receiptCount, 1);
    assertEq(secondState.receiptCount, 1);
    assertEq(firstState.totalEscrowed, firstQuote.cost);
    assertEq(secondState.totalEscrowed, secondQuote.cost);
    assertEq(firstState.path, firstQuote.rHigh);
    assertEq(secondState.path, secondQuote.rLow);
    assertEq(firstState.yesShares, firstShares);
    assertEq(firstState.noShares, 0);
    assertEq(secondState.yesShares, 0);
    assertEq(secondState.noShares, secondShares);
    assertEq(collateral.balanceOf(address(manager)), firstQuote.cost + secondQuote.cost);
  }

  function test_RevertsForUnknownMarket() public {
    vm.expectRevert(abi.encodeWithSelector(PregradManager.MarketDoesNotExist.selector, 1));
    manager.getMarketConfig(1);

    vm.expectRevert(abi.encodeWithSelector(PregradManager.ReceiptDoesNotExist.selector, 1));
    manager.getReceipt(1);
  }

  function test_RevertsForInvalidMarketConfig() public {
    MarketTypes.CreateMarketParams memory params = MarketTypes.CreateMarketParams({
      collateral: address(0),
      metadataHash: keccak256("ipfs://popcharts/example"),
      openingProbabilityWad: (50 * WAD) / 100,
      liquidityParameter: 5_000 * WAD,
      graduationThreshold: 40_000 * WAD,
      graduationTime: uint64(block.timestamp + 7 days),
      resolutionTime: uint64(block.timestamp + 14 days)
    });

    vm.expectRevert(PregradManager.InvalidCollateral.selector);
    manager.createMarket(params);

    params.collateral = address(collateral);
    params.metadataHash = bytes32(0);
    vm.expectRevert(PregradManager.InvalidMetadataHash.selector);
    manager.createMarket(params);

    params.metadataHash = keccak256("ipfs://popcharts/example");
    params.openingProbabilityWad = 0;
    vm.expectRevert(abi.encodeWithSelector(LmsrMath.InvalidProbability.selector, 0));
    manager.createMarket(params);

    params.openingProbabilityWad = WAD;
    vm.expectRevert(abi.encodeWithSelector(LmsrMath.InvalidProbability.selector, WAD));
    manager.createMarket(params);

    params.openingProbabilityWad = (50 * WAD) / 100;
    params.liquidityParameter = 0;
    vm.expectRevert(LmsrMath.InvalidLiquidityParameter.selector);
    manager.createMarket(params);

    params.liquidityParameter = 5_000 * WAD;
    params.graduationThreshold = 0;
    vm.expectRevert(PregradManager.InvalidGraduationThreshold.selector);
    manager.createMarket(params);

    params.graduationThreshold = 40_000 * WAD;
    params.graduationTime = uint64(block.timestamp);
    vm.expectRevert(PregradManager.InvalidGraduationTime.selector);
    manager.createMarket(params);

    params.graduationTime = uint64(block.timestamp + 7 days);
    params.resolutionTime = params.graduationTime;
    vm.expectRevert(PregradManager.InvalidResolutionTime.selector);
    manager.createMarket(params);

    params.resolutionTime = uint64(block.timestamp);
    vm.expectRevert(PregradManager.InvalidResolutionTime.selector);
    manager.createMarket(params);
  }

  function test_RevertsForInvalidReceiptPlacement() public {
    address buyer = makeAddr("buyer");
    uint256 marketId = _createDefaultMarket();
    uint256 shares = 100 * WAD;
    MarketTypes.PlaceReceiptParams memory params = MarketTypes.PlaceReceiptParams({
      marketId: 999,
      side: MarketTypes.Side.Yes,
      shares: shares,
      maxCost: type(uint256).max
    });

    vm.expectRevert(abi.encodeWithSelector(PregradManager.MarketDoesNotExist.selector, 999));
    manager.placeReceipt(params);

    params.marketId = marketId;
    params.shares = 0;
    vm.expectRevert(PregradManager.InvalidShares.selector);
    manager.placeReceipt(params);

    vm.expectRevert(PregradManager.InvalidShares.selector);
    manager.quoteReceipt(marketId, MarketTypes.Side.Yes, 0);

    params.shares = shares;
    MarketTypes.ReceiptQuote memory quote = manager.quoteReceipt(
      marketId,
      MarketTypes.Side.Yes,
      shares
    );
    params.maxCost = quote.cost - 1;
    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.CostExceedsLimit.selector, quote.cost, quote.cost - 1)
    );
    manager.placeReceipt(params);

    collateral.mint(buyer, 1_000 * WAD);
    vm.prank(buyer);
    collateral.approve(address(manager), type(uint256).max);

    MarketTypes.MarketConfig memory config = manager.getMarketConfig(marketId);
    vm.warp(config.graduationTime);
    params.maxCost = quote.cost;
    vm.prank(buyer);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.MarketPastGraduationTime.selector,
        marketId,
        config.graduationTime
      )
    );
    manager.placeReceipt(params);
  }

  function test_RevertsWhenCollateralTransferDoesNotMatchReceiptCost() public {
    address buyer = makeAddr("buyer");
    MockFeeCollateral feeCollateral = new MockFeeCollateral();
    uint256 marketId = manager.createMarket(
      MarketTypes.CreateMarketParams({
        collateral: address(feeCollateral),
        metadataHash: keccak256("ipfs://popcharts/fee-collateral"),
        openingProbabilityWad: (50 * WAD) / 100,
        liquidityParameter: 5_000 * WAD,
        graduationThreshold: 40_000 * WAD,
        graduationTime: uint64(block.timestamp + 7 days),
        resolutionTime: uint64(block.timestamp + 14 days)
      })
    );

    uint256 shares = 100 * WAD;
    MarketTypes.ReceiptQuote memory quote = manager.quoteReceipt(
      marketId,
      MarketTypes.Side.Yes,
      shares
    );
    uint256 received = quote.cost - ((quote.cost * 100) / 10_000);

    feeCollateral.mint(buyer, 1_000 * WAD);
    vm.prank(buyer);
    feeCollateral.approve(address(manager), type(uint256).max);

    vm.prank(buyer);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidCollateralTransfer.selector,
        quote.cost,
        received
      )
    );
    manager.placeReceipt(
      MarketTypes.PlaceReceiptParams({
        marketId: marketId,
        side: MarketTypes.Side.Yes,
        shares: shares,
        maxCost: quote.cost
      })
    );
  }

  function _createDefaultMarket() private returns (uint256) {
    return manager.createMarket(_defaultMarketParams(keccak256("ipfs://popcharts/example")));
  }

  function _createSecondDefaultMarket() private returns (uint256) {
    return manager.createMarket(_defaultMarketParams(keccak256("ipfs://popcharts/second")));
  }

  function _defaultMarketParams(
    bytes32 metadataHash
  ) private view returns (MarketTypes.CreateMarketParams memory) {
    return
      MarketTypes.CreateMarketParams({
        collateral: address(collateral),
        metadataHash: metadataHash,
        openingProbabilityWad: (50 * WAD) / 100,
        liquidityParameter: 5_000 * WAD,
        graduationThreshold: 40_000 * WAD,
        graduationTime: uint64(block.timestamp + 7 days),
        resolutionTime: uint64(block.timestamp + 14 days)
      });
  }

  function _fundAndApprove(address account, uint256 amount) private {
    collateral.mint(account, amount);
    vm.prank(account);
    collateral.approve(address(manager), type(uint256).max);
  }

  function _placeReceiptAs(
    address buyer,
    uint256 marketId,
    MarketTypes.Side side,
    uint256 shares
  ) private returns (uint256 receiptId, MarketTypes.ReceiptQuote memory quote) {
    quote = manager.quoteReceipt(marketId, side, shares);

    vm.prank(buyer);
    receiptId = manager.placeReceipt(
      MarketTypes.PlaceReceiptParams({
        marketId: marketId,
        side: side,
        shares: shares,
        maxCost: quote.cost
      })
    );
  }
}
