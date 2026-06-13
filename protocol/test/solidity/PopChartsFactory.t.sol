// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {MockCollateral} from "../../contracts/mocks/MockCollateral.sol";
import {PopChartsFactory} from "../../contracts/PopChartsFactory.sol";
import {PregradMarket} from "../../contracts/PregradMarket.sol";
import {LmsrMath} from "../../contracts/libraries/LmsrMath.sol";
import {MarketTypes} from "../../contracts/types/MarketTypes.sol";

contract PopChartsFactoryTest is Test {
  uint256 private constant WAD = 1e18;

  MockCollateral private collateral;
  PopChartsFactory private factory;

  function setUp() public {
    collateral = new MockCollateral();
    factory = new PopChartsFactory();
  }

  function test_CreateMarketStoresBootstrapConfig() public {
    bytes32 metadataHash = keccak256("ipfs://popcharts/example");

    address marketAddress = factory.createMarket(
      MarketTypes.CreateMarketParams({
        collateral: address(collateral),
        metadataHash: metadataHash,
        openingProbabilityWad: (50 * WAD) / 100,
        liquidityParameter: 5_000 * WAD,
        graduationThreshold: 40_000 * WAD,
        closeTime: uint64(block.timestamp + 7 days)
      })
    );

    PregradMarket market = PregradMarket(marketAddress);
    MarketTypes.MarketConfig memory config = market.getConfig();

    assertEq(factory.marketCount(), 1);
    assertEq(factory.marketAt(0), marketAddress);
    assertEq(config.collateral, address(collateral));
    assertEq(config.creator, address(this));
    assertEq(config.metadataHash, metadataHash);
    assertEq(config.openingProbabilityWad, (50 * WAD) / 100);
    assertEq(config.liquidityParameter, 5_000 * WAD);
    assertEq(config.graduationThreshold, 40_000 * WAD);
    assertEq(uint256(market.status()), uint256(MarketTypes.MarketStatus.Bootstrap));
  }

  function test_RevertsForZeroOpeningProbability() public {
    vm.expectRevert(abi.encodeWithSelector(LmsrMath.InvalidProbability.selector, 0));

    factory.createMarket(
      MarketTypes.CreateMarketParams({
        collateral: address(collateral),
        metadataHash: keccak256("ipfs://popcharts/example"),
        openingProbabilityWad: 0,
        liquidityParameter: 5_000 * WAD,
        graduationThreshold: 40_000 * WAD,
        closeTime: uint64(block.timestamp + 7 days)
      })
    );
  }
}
