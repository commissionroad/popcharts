// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockFeeCollateral
/// @author Pop Charts
/// @notice Test-only collateral token that burns one percent of transfers.
contract MockFeeCollateral is ERC20 {
  uint256 private constant FEE_BPS = 100;
  uint256 private constant BPS_DENOMINATOR = 10_000;

  /// @notice Initializes the fee-charging mock collateral token metadata.
  constructor() ERC20("Pop Charts Fee USD", "fUSD") {}

  /// @notice Mints test collateral to an account.
  /// @param account Recipient address.
  /// @param amount Token amount to mint.
  function mint(address account, uint256 amount) external {
    _mint(account, amount);
  }

  /// @notice Applies the mock transfer fee on non-mint and non-burn transfers.
  /// @param from Sender address, or zero during mint.
  /// @param to Recipient address, or zero during burn.
  /// @param value Token amount before the transfer fee.
  function _update(address from, address to, uint256 value) internal override {
    if (from == address(0) || to == address(0) || value == 0) {
      super._update(from, to, value);
      return;
    }

    uint256 fee = (value * FEE_BPS) / BPS_DENOMINATOR;
    super._update(from, to, value - fee);
    super._update(from, address(0), fee);
  }
}
