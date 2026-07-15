// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

import {CallJournal} from "./CallJournal.sol";

/// @title TokenPullerRecordingMock
/// @author Pop Charts
/// @notice Records allowance-transfer calls made by delta settlement.
contract TokenPullerRecordingMock {
  CallJournal private immutable JOURNAL;

  address private recordedFrom;
  address private recordedTo;
  uint160 private recordedAmount;
  address private recordedToken;
  uint256 private recordedCallCount;

  /// @notice Creates a token-puller recorder using a shared journal.
  /// @param callJournal Shared call-order journal.
  constructor(CallJournal callJournal) {
    JOURNAL = callJournal;
  }

  /// @notice Records an allowance-transfer request.
  /// @param from Token owner.
  /// @param to Token recipient.
  /// @param amount Token amount.
  /// @param token Token address.
  function transferFrom(address from, address to, uint160 amount, address token) external {
    JOURNAL.record("pull");
    recordedFrom = from;
    recordedTo = to;
    recordedAmount = amount;
    recordedToken = token;
    ++recordedCallCount;
  }

  /// @notice Returns the number of recorded pulls.
  /// @return count Recorded pull count.
  function callCount() external view returns (uint256 count) {
    return recordedCallCount;
  }

  /// @notice Returns the last recorded pull arguments.
  /// @return from Token owner.
  /// @return to Token recipient.
  /// @return amount Token amount.
  /// @return token Token address.
  function lastCall()
    external
    view
    returns (address from, address to, uint160 amount, address token)
  {
    return (recordedFrom, recordedTo, recordedAmount, recordedToken);
  }
}
