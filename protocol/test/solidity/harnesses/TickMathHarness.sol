// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

import {TickMath} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/TickMath.sol";

/// @title TickMathHarness
/// @author Pop Charts
/// @notice Exposes v4-core TickMath so Node.js parity tests can anchor the
///   TypeScript tick-math ports in `protocol/scripts/shared/price/` against
///   the exact math bounded pools run on-chain (ADR 0016 C6).
contract TickMathHarness {
  /// @notice Canonical Q64.96 square-root price at a tick.
  /// @param tick Tick to convert.
  /// @return Square-root price for the tick.
  function getSqrtPriceAtTick(int24 tick) external pure returns (uint160) {
    return TickMath.getSqrtPriceAtTick(tick);
  }

  /// @notice Greatest tick whose sqrt price is at or below `sqrtPriceX96`.
  /// @param sqrtPriceX96 Square-root price to convert.
  /// @return Floor tick of the price.
  function getTickAtSqrtPrice(uint160 sqrtPriceX96) external pure returns (int24) {
    return TickMath.getTickAtSqrtPrice(sqrtPriceX96);
  }
}
