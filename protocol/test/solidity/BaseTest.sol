// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {MockCollateral} from "../../contracts/mocks/MockCollateral.sol";
import {PregradManager} from "../../contracts/PregradManager.sol";

/// Shared fixtures for the Solidity test suites that exercise the pregrad and
/// postgrad market contracts against the 18-decimal mock collateral. Suites
/// with bespoke environments (the v4 venue stack pinned to solc 0.8.26 and the
/// pure-library harness tests) intentionally do not inherit from this.
abstract contract BaseTest is Test {
  uint256 internal constant WAD = 1e18;

  MockCollateral internal collateral;

  function setUp() public virtual {
    collateral = new MockCollateral();
  }

  /// Deploys a PregradManager owned by the test contract with the test
  /// contract registered as a trusted creator.
  function _deployPregradManager() internal returns (PregradManager manager) {
    manager = new PregradManager();
    manager.setTrustedCreator(address(this), true);
  }

  /// Mints `mintAmount` of the shared mock collateral to `account` and lets
  /// `spender` pull up to `approveAmount` of it.
  function _fundAndApprove(
    address account,
    address spender,
    uint256 mintAmount,
    uint256 approveAmount
  ) internal {
    collateral.mint(account, mintAmount);
    vm.prank(account);
    collateral.approve(spender, approveAmount);
  }
}
