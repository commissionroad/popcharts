// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {MarketTypes} from "../types/MarketTypes.sol";

/// @title IPregradMarket
/// @author Pop Charts
/// @notice Minimal read interface for a pre-graduation market.
interface IPregradMarket {
  /// @notice Returns immutable market configuration.
  function getConfig() external view returns (MarketTypes.MarketConfig memory);

  /// @notice Returns the current market lifecycle status.
  function status() external view returns (MarketTypes.MarketStatus);
}
