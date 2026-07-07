// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {IPostgradAdapter} from "../../../contracts/postgrad/IPostgradAdapter.sol";
import {MarketTypes} from "../../../contracts/types/MarketTypes.sol";

/// @notice Test adapter that pulls the retained collateral like a well-behaved
/// implementation but reports an outcome capacity that disagrees with the
/// clearing root, so tests can prove PregradManager rejects the handoff
/// instead of trusting the adapter's self-report.
contract MisreportingPostgradAdapter is IPostgradAdapter {
  using SafeERC20 for IERC20;

  uint256 public immutable capacityDelta;

  constructor(uint256 capacityDelta_) {
    capacityDelta = capacityDelta_;
  }

  function prepareMarket(
    uint256,
    address collateral,
    bytes32,
    uint256 retainedCollateral,
    uint256 completeSetCount
  ) external returns (address postgradMarket, uint256 outcomeCapacity) {
    IERC20(collateral).safeTransferFrom(msg.sender, address(this), retainedCollateral);
    postgradMarket = address(this);
    outcomeCapacity = completeSetCount - capacityDelta;
  }

  function distributeOutcome(uint256, address, MarketTypes.Side, uint256) external {}
}
