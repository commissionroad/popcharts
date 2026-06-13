// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {MockCollateral} from "../../contracts/mocks/MockCollateral.sol";
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

  MockCollateral private collateral;
  PregradManager private manager;

  function setUp() public {
    collateral = new MockCollateral();
    manager = new PregradManager();
  }

  function test_CreateMarketStoresActiveConfigAndEmitsEvent() public {
    bytes32 metadataHash = keccak256("ipfs://popcharts/example");
    uint64 graduationTime = uint64(block.timestamp + 7 days);
    uint64 resolutionTime = uint64(block.timestamp + 14 days);

    vm.expectEmit(true, true, true, true, address(manager));
    emit MarketCreated(
      1,
      address(this),
      metadataHash,
      address(collateral),
      (50 * WAD) / 100,
      5_000 * WAD,
      40_000 * WAD,
      graduationTime,
      resolutionTime
    );

    uint256 marketId = manager.createMarket(
      MarketTypes.CreateMarketParams({
        collateral: address(collateral),
        metadataHash: metadataHash,
        openingProbabilityWad: (50 * WAD) / 100,
        liquidityParameter: 5_000 * WAD,
        graduationThreshold: 40_000 * WAD,
        graduationTime: graduationTime,
        resolutionTime: resolutionTime
      })
    );

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
    assertEq(config.graduationTime, graduationTime);
    assertEq(config.resolutionTime, resolutionTime);
    assertEq(uint256(state.status), uint256(MarketTypes.MarketStatus.Active));
    assertEq(state.receiptCount, 0);
    assertEq(state.totalEscrowed, 0);
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

  function test_RevertsForUnknownMarket() public {
    vm.expectRevert(abi.encodeWithSelector(PregradManager.MarketDoesNotExist.selector, 1));
    manager.getMarketConfig(1);
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
}
