// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

// solhint-disable use-natspec

import {IERC20Minimal} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/external/IERC20Minimal.sol";

contract AllowanceTransferMock {
  error TransferFailed(address token, address from, address to, uint256 amount);

  function transferFrom(address from, address to, uint160 amount, address token) external {
    bool transferred = IERC20Minimal(token).transferFrom(from, to, uint256(amount));
    if (!transferred) {
      revert TransferFailed(token, from, to, uint256(amount));
    }
  }
}
