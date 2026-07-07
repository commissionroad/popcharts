// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title CreationFeeVault
/// @author Pop Charts
/// @notice Custody mechanics for native market-creation fees: exact-amount
///   collection and owner-directed withdrawal. Policy — who pays, how much,
///   and who may withdraw — stays in the inheriting contract; this base only
///   accounts for and moves the native balance it collected, so receipt
///   escrow held by the same contract can never be withdrawn as fees.
abstract contract CreationFeeVault {
  /// @notice Reverts when owner fee withdrawal targets the zero account.
  error InvalidCreationFeeRecipient();
  /// @notice Reverts when a market creation transaction sends the wrong native fee.
  /// @param expected Native fee required for the creator.
  /// @param received Native value sent with the transaction.
  error InvalidMarketCreationFee(uint256 expected, uint256 received);
  /// @notice Reverts when owner fee withdrawal exceeds collected fees.
  /// @param available Collected fees available for withdrawal.
  /// @param requested Fee amount requested by the owner.
  error CreationFeeWithdrawalExceedsBalance(uint256 available, uint256 requested);
  /// @notice Reverts when native fee withdrawal fails.
  /// @param recipient Account that should have received the fees.
  /// @param amount Fee amount attempted.
  error CreationFeeWithdrawalFailed(address recipient, uint256 amount);

  /// @notice Emitted when a public creator pays the market creation fee.
  /// @param marketId Market whose creation paid the fee.
  /// @param creator Account that paid the fee.
  /// @param amount Exact native amount collected as the fee.
  event MarketCreationFeePaid(uint256 indexed marketId, address indexed creator, uint256 amount);

  /// @notice Emitted when the owner withdraws collected market creation fees.
  /// @param recipient Account receiving the fees.
  /// @param amount Fee amount withdrawn.
  event CreationFeesWithdrawn(address indexed recipient, uint256 amount);

  uint256 private _collectedCreationFees;

  /// @notice Returns collected native market creation fees not yet withdrawn.
  /// @return Fee amount collected and not yet withdrawn.
  function collectedCreationFees() external view returns (uint256) {
    return _collectedCreationFees;
  }

  /// @notice Validates and accounts for the native market creation fee.
  /// @param amount Exact native fee amount required.
  function _collectCreationFee(uint256 amount) internal {
    if (msg.value != amount) {
      revert InvalidMarketCreationFee(amount, msg.value);
    }

    _collectedCreationFees += amount;
  }

  /// @notice Withdraws collected creation fees; caller enforces access control.
  /// @param recipient Account receiving the fees.
  /// @param amount Fee amount to withdraw.
  function _withdrawCreationFees(address payable recipient, uint256 amount) internal {
    if (recipient == address(0)) {
      revert InvalidCreationFeeRecipient();
    }

    uint256 available = _collectedCreationFees;
    if (amount > available) {
      revert CreationFeeWithdrawalExceedsBalance(available, amount);
    }

    _collectedCreationFees = available - amount;
    (bool success, ) = recipient.call{value: amount}("");
    if (!success) {
      revert CreationFeeWithdrawalFailed(recipient, amount);
    }

    emit CreationFeesWithdrawn(recipient, amount);
  }
}
