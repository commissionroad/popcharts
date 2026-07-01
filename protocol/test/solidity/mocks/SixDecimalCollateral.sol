// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SixDecimalCollateral is ERC20 {
  constructor() ERC20("Six Decimal USD", "sUSD") {}

  function decimals() public pure override returns (uint8) {
    return 6;
  }

  function mint(address account, uint256 amount) external {
    _mint(account, amount);
  }
}
