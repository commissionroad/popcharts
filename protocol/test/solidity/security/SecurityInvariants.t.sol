// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";

/// @dev Phase 0 scaffold for the ADR 0023 security audit program. It proves the
/// `test/solidity/security/` path is wired into `hardhat test solidity`; audit
/// item A10 replaces this with real invariant harnesses for the two keystone
/// properties the peer-audit corpus says matter most (see Section C):
///
///  1. Escrow / pool solvency — outstanding shares plus pending Merkle claims
///     are always <= collateral held (Trail of Bits Uniswap v4: "the singleton
///     can always cover its debts").
///  2. Complete-set conservation / sum-to-one — split, merge, LMSR trade, and
///     redeem conserve value exactly (Gnosis Conditional Tokens Framework).
///
/// Until A10 lands, this is a placeholder so the suite stays green and the
/// directory is discoverable.
contract SecurityInvariantsTest is Test {
  function test_SecurityTestPathIsWired() public pure {
    assertTrue(true);
  }
}
