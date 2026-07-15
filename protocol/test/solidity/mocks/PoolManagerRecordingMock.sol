// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

import {Currency} from "@uniswap/v4-periphery/lib/v4-core/src/types/Currency.sol";
import {CallJournal} from "./CallJournal.sol";

/// @title PoolManagerRecordingMock
/// @author Pop Charts
/// @notice Records the pool-manager selectors used by delta-settlement tests.
contract PoolManagerRecordingMock {
  CallJournal private immutable JOURNAL;

  Currency[] private takenCurrencies;
  address[] private takenRecipients;
  uint256[] private takenAmounts;

  /// @notice Creates a pool-manager recorder using a shared journal.
  /// @param callJournal Shared call-order journal.
  constructor(CallJournal callJournal) {
    JOURNAL = callJournal;
  }

  /// @notice Records a currency sync.
  /// @param currency Currency being synced.
  function sync(Currency currency) external {
    currency;
    JOURNAL.record("sync");
  }

  /// @notice Records a currency withdrawal.
  /// @param currency Currency being withdrawn.
  /// @param to Withdrawal recipient.
  /// @param amount Withdrawal amount.
  function take(Currency currency, address to, uint256 amount) external {
    JOURNAL.record("take");
    takenCurrencies.push(currency);
    takenRecipients.push(to);
    takenAmounts.push(amount);
  }

  /// @notice Records settlement completion.
  /// @return paidAmount Mock paid amount, always zero.
  function settle() external payable returns (uint256 paidAmount) {
    JOURNAL.record("settle");
    return 0;
  }

  /// @notice Returns the number of recorded take calls.
  /// @return count Recorded take-call count.
  function takeCount() external view returns (uint256 count) {
    return takenCurrencies.length;
  }

  /// @notice Returns one recorded take call.
  /// @param index Take-call index.
  /// @return currency Recorded currency.
  /// @return recipient Recorded recipient.
  /// @return amount Recorded amount.
  function takeAt(
    uint256 index
  ) external view returns (Currency currency, address recipient, uint256 amount) {
    return (takenCurrencies[index], takenRecipients[index], takenAmounts[index]);
  }
}
