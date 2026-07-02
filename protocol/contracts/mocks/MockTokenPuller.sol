// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title MockTokenPuller
/// @author Pop Charts
/// @notice Test-only allowance-transfer stand-in for the canonical
/// transfer-approval singleton on local devchains, matching the ITokenPuller
/// interface the bounded-pool order manager uses to pull maker input tokens.
/// @dev Local devchains only: any caller can spend allowances granted to this
/// contract, so it must never be deployed to a public chain.
contract MockTokenPuller {
  using SafeERC20 for IERC20;

  /// @notice Transfers approved ERC20 tokens from an owner to a recipient.
  /// @param from Token owner that approved this contract.
  /// @param to Token recipient.
  /// @param amount Token amount.
  /// @param token ERC20 token address.
  function transferFrom(address from, address to, uint160 amount, address token) external {
    IERC20(token).safeTransferFrom(from, to, uint256(amount));
  }
}
