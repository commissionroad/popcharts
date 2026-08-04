// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReviewCreditVault} from "../../contracts/ReviewCreditVault.sol";

/// Recipient with no receive/fallback, so native transfers to it fail and the
/// vault's sweep-failed revert path can be exercised.
contract RejectingRecipient {
  function depositTo(ReviewCreditVault vault, address beneficiary) external payable {
    vault.depositFor{value: msg.value}(beneficiary);
  }
}

/// The vault holds plain native value and needs no collateral token, so this
/// suite intentionally does not inherit from BaseTest.
contract ReviewCreditVaultTest is Test {
  uint256 internal constant WAD = 1e18;

  ReviewCreditVault private vault;
  address private alice;
  address private bob;
  address payable private treasury;

  function setUp() public {
    alice = makeAddr("alice");
    bob = makeAddr("bob");
    treasury = payable(makeAddr("treasury"));
    vault = new ReviewCreditVault(address(this));

    vm.deal(alice, 100 * WAD);
    vm.deal(bob, 100 * WAD);
  }

  // ---------------------------------------------------------------- deposits

  function test_DepositAccumulatesAndEmits() public {
    vm.expectEmit(true, true, true, true, address(vault));
    emit ReviewCreditVault.ReviewCreditDeposited(alice, alice, 5 * WAD, 5 * WAD);
    vm.prank(alice);
    vault.depositFor{value: 5 * WAD}(alice);

    vm.expectEmit(true, true, true, true, address(vault));
    emit ReviewCreditVault.ReviewCreditDeposited(alice, alice, 2 * WAD, 7 * WAD);
    vm.prank(alice);
    vault.depositFor{value: 2 * WAD}(alice);

    assertEq(vault.depositedOf(alice), 7 * WAD);
    assertEq(vault.collectedFees(), 7 * WAD);
    assertEq(address(vault).balance, 7 * WAD);
  }

  function test_DepositCreditsTheNamedBeneficiaryNotThePayer() public {
    vm.expectEmit(true, true, true, true, address(vault));
    emit ReviewCreditVault.ReviewCreditDeposited(bob, alice, 3 * WAD, 3 * WAD);
    vm.prank(alice);
    vault.depositFor{value: 3 * WAD}(bob);

    assertEq(vault.depositedOf(bob), 3 * WAD);
    assertEq(vault.depositedOf(alice), 0);
  }

  function test_DepositsFromSeveralPayersAccrueToOneBeneficiary() public {
    vm.prank(alice);
    vault.depositFor{value: 1 * WAD}(bob);
    vm.prank(bob);
    vault.depositFor{value: 4 * WAD}(bob);

    assertEq(vault.depositedOf(bob), 5 * WAD);
    assertEq(vault.collectedFees(), 5 * WAD);
  }

  function test_DepositBalancesAreIndependentPerBeneficiary() public {
    vm.prank(alice);
    vault.depositFor{value: 6 * WAD}(alice);
    vm.prank(bob);
    vault.depositFor{value: 2 * WAD}(bob);

    assertEq(vault.depositedOf(alice), 6 * WAD);
    assertEq(vault.depositedOf(bob), 2 * WAD);
  }

  function test_DepositRevertsWithoutValue() public {
    vm.expectRevert(ReviewCreditVault.InvalidReviewCreditDeposit.selector);
    vm.prank(alice);
    vault.depositFor{value: 0}(alice);
  }

  function test_DepositRevertsForZeroBeneficiary() public {
    vm.expectRevert(ReviewCreditVault.InvalidReviewCreditBeneficiary.selector);
    vm.prank(alice);
    vault.depositFor{value: 1 * WAD}(address(0));
  }

  /// The zero-beneficiary check runs first, so a call that is wrong on both
  /// counts names the unrecoverable mistake rather than the recoverable one.
  function test_DepositRevertsForZeroBeneficiaryBeforeZeroValue() public {
    vm.expectRevert(ReviewCreditVault.InvalidReviewCreditBeneficiary.selector);
    vm.prank(alice);
    vault.depositFor{value: 0}(address(0));
  }

  function test_DepositedOfIsZeroForAnUnknownAccount() public view {
    assertEq(vault.depositedOf(address(0xdead)), 0);
  }

  // --------------------------------------------------------- no way back out

  /// Credit is non-refundable by construction: the vault exposes no user-facing
  /// exit, and a plain native transfer cannot manufacture one either because
  /// there is no receive or fallback function.
  function test_StrayNativeTransferReverts() public {
    vm.prank(alice);
    (bool success, ) = address(vault).call{value: 1 * WAD}("");

    assertFalse(success);
    assertEq(address(vault).balance, 0);
  }

  function test_RetiredWithdrawBondSelectorIsGone() public {
    vm.prank(alice);
    (bool success, ) = address(vault).call(abi.encodeWithSignature("withdrawBond(uint256)", WAD));

    assertFalse(success);
  }

  // ------------------------------------------------------------------ sweeps

  function test_OwnerSweepsTheWholeBalance() public {
    vm.prank(alice);
    vault.depositFor{value: 5 * WAD}(alice);
    vm.prank(bob);
    vault.depositFor{value: 3 * WAD}(bob);

    vm.expectEmit(true, true, true, true, address(vault));
    emit ReviewCreditVault.ReviewFeesWithdrawn(treasury, 8 * WAD);
    vault.withdrawCollectedFees(treasury);

    assertEq(treasury.balance, 8 * WAD);
    assertEq(address(vault).balance, 0);
    assertEq(vault.collectedFees(), 0);
  }

  /// Sweeping moves value out but changes nobody's recorded deposits — the
  /// off-chain meter reads `depositedOf`, so a sweep must not look like spending.
  function test_SweepLeavesDepositTotalsIntact() public {
    vm.prank(alice);
    vault.depositFor{value: 5 * WAD}(alice);

    vault.withdrawCollectedFees(treasury);

    assertEq(vault.depositedOf(alice), 5 * WAD);
  }

  function test_DepositAfterSweepAccumulatesOnTop() public {
    vm.prank(alice);
    vault.depositFor{value: 5 * WAD}(alice);
    vault.withdrawCollectedFees(treasury);

    vm.prank(alice);
    vault.depositFor{value: 2 * WAD}(alice);

    assertEq(vault.depositedOf(alice), 7 * WAD);
    assertEq(vault.collectedFees(), 2 * WAD);
  }

  function test_SweepRevertsForNonOwner() public {
    vm.prank(alice);
    vault.depositFor{value: 1 * WAD}(alice);

    vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
    vm.prank(alice);
    vault.withdrawCollectedFees(treasury);
  }

  function test_SweepRevertsForZeroRecipient() public {
    vm.prank(alice);
    vault.depositFor{value: 1 * WAD}(alice);

    vm.expectRevert(ReviewCreditVault.InvalidReviewFeeRecipient.selector);
    vault.withdrawCollectedFees(payable(address(0)));
  }

  function test_SweepRevertsWhenEmpty() public {
    vm.expectRevert(ReviewCreditVault.NoCollectedReviewFees.selector);
    vault.withdrawCollectedFees(treasury);
  }

  function test_SweepRevertsWhenTheRecipientRejectsValue() public {
    RejectingRecipient rejecting = new RejectingRecipient();
    vm.prank(alice);
    vault.depositFor{value: 4 * WAD}(alice);

    vm.expectRevert(
      abi.encodeWithSelector(
        ReviewCreditVault.ReviewFeeWithdrawalFailed.selector,
        address(rejecting),
        4 * WAD
      )
    );
    vault.withdrawCollectedFees(payable(address(rejecting)));

    // The revert unwinds the whole sweep, so the balance is still claimable.
    assertEq(vault.collectedFees(), 4 * WAD);
  }

  /// A contract with no receive function can still fund credit, because
  /// depositing pushes value in rather than pulling it back.
  function test_ContractWithoutReceiveCanFundABeneficiary() public {
    RejectingRecipient payer = new RejectingRecipient();
    vm.deal(address(payer), 3 * WAD);

    payer.depositTo{value: 3 * WAD}(vault, alice);

    assertEq(vault.depositedOf(alice), 3 * WAD);
  }

  // -------------------------------------------------------------------- fuzz

  function testFuzz_DepositsSumIntoTheBeneficiaryTotal(uint96 first, uint96 second) public {
    vm.assume(first > 0 && second > 0);
    vm.deal(alice, uint256(first) + uint256(second));

    vm.startPrank(alice);
    vault.depositFor{value: first}(bob);
    vault.depositFor{value: second}(bob);
    vm.stopPrank();

    assertEq(vault.depositedOf(bob), uint256(first) + uint256(second));
    assertEq(vault.collectedFees(), uint256(first) + uint256(second));
  }
}
