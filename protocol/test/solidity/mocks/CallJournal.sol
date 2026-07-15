// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

/// @title CallJournal
/// @author Pop Charts
/// @notice Records labels shared across collaborating recording mocks.
contract CallJournal {
  string[] private labels;

  /// @notice Appends a call label.
  /// @param label Label describing the recorded call.
  function record(string calldata label) external {
    labels.push(label);
  }

  /// @notice Returns the number of recorded labels.
  /// @return count Recorded label count.
  function labelCount() external view returns (uint256 count) {
    return labels.length;
  }

  /// @notice Returns a recorded label by index.
  /// @param index Label index.
  /// @return label Recorded label.
  function labelAt(uint256 index) external view returns (string memory label) {
    return labels[index];
  }
}
