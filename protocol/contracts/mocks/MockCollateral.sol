// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockCollateral
/// @author Pop Charts
/// @notice Test-only collateral token for local protocol tests.
contract MockCollateral is ERC20 {
  constructor() ERC20("Pop Charts Test USD", "pUSD") {}

  /// @notice Mints test collateral to an account.
  /// @param account Recipient address.
  /// @param amount Token amount to mint.
  function mint(address account, uint256 amount) external {
    _mint(account, amount);
  }
}
