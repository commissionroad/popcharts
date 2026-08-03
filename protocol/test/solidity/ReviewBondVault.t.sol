// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReviewBondVault} from "../../contracts/ReviewBondVault.sol";

/// Recipient with no receive/fallback, so native transfers to it fail and the
/// vault's withdrawal-failed revert paths can be exercised.
contract RejectingRecipient {
  function depositTo(ReviewBondVault vault) external payable {
    vault.depositBond{value: msg.value}();
  }

  function withdrawFrom(ReviewBondVault vault, uint256 amount) external {
    vault.withdrawBond(amount);
  }
}

/// The vault holds plain native value and needs no collateral token, so this
/// suite intentionally does not inherit from BaseTest.
contract ReviewBondVaultTest is Test {
  uint256 internal constant WAD = 1e18;

  ReviewBondVault private vault;
  address private resolver;
  address private alice;
  address private bob;
  address payable private treasury;

  function setUp() public {
    resolver = makeAddr("resolver");
    alice = makeAddr("alice");
    bob = makeAddr("bob");
    treasury = payable(makeAddr("treasury"));
    vault = new ReviewBondVault(address(this), resolver);

    vm.deal(alice, 100 * WAD);
    vm.deal(bob, 100 * WAD);
  }

  // ---------------------------------------------------------------- deposits

  function test_DepositAccumulatesAndEmits() public {
    vm.expectEmit(true, true, true, true, address(vault));
    emit ReviewBondVault.ReviewBondDeposited(alice, 5 * WAD, 5 * WAD);
    vm.prank(alice);
    vault.depositBond{value: 5 * WAD}();

    vm.expectEmit(true, true, true, true, address(vault));
    emit ReviewBondVault.ReviewBondDeposited(alice, 2 * WAD, 7 * WAD);
    vm.prank(alice);
    vault.depositBond{value: 2 * WAD}();

    assertEq(vault.depositedOf(alice), 7 * WAD);
    assertEq(vault.settledConsumedOf(alice), 0);
    assertEq(vault.availableBond(alice), 7 * WAD);
    assertEq(vault.collectedFees(), 0);
    assertEq(address(vault).balance, 7 * WAD);
  }

  function test_ZeroDepositReverts() public {
    vm.expectRevert(ReviewBondVault.InvalidReviewBondDeposit.selector);
    vm.prank(alice);
    vault.depositBond{value: 0}();
  }

  // -------------------------------------------------------------- settlement

  function test_SettleMovesDeltaIntoPoolAndEmits() public {
    vm.prank(alice);
    vault.depositBond{value: 5 * WAD}();

    vm.expectEmit(true, true, true, true, address(vault));
    emit ReviewBondVault.ReviewFeesSettled(alice, 2 * WAD, 2 * WAD);
    vm.prank(resolver);
    vault.settle(alice, 2 * WAD);

    assertEq(vault.settledConsumedOf(alice), 2 * WAD);
    assertEq(vault.availableBond(alice), 3 * WAD);
    assertEq(vault.collectedFees(), 2 * WAD);
    assertEq(address(vault).balance, 5 * WAD);

    // A later settlement only moves the newly consumed delta.
    vm.expectEmit(true, true, true, true, address(vault));
    emit ReviewBondVault.ReviewFeesSettled(alice, WAD, 3 * WAD);
    vm.prank(resolver);
    vault.settle(alice, 3 * WAD);

    assertEq(vault.settledConsumedOf(alice), 3 * WAD);
    assertEq(vault.availableBond(alice), 2 * WAD);
    assertEq(vault.collectedFees(), 3 * WAD);
  }

  function test_SettleByNonResolverReverts() public {
    vm.prank(alice);
    vault.depositBond{value: 5 * WAD}();

    // Even the owner cannot settle without the resolver role.
    vm.expectRevert(
      abi.encodeWithSelector(ReviewBondVault.UnauthorizedSettlementResolver.selector, address(this))
    );
    vault.settle(alice, WAD);

    address rando = makeAddr("rando");
    vm.expectRevert(
      abi.encodeWithSelector(ReviewBondVault.UnauthorizedSettlementResolver.selector, rando)
    );
    vm.prank(rando);
    vault.settle(alice, WAD);
  }

  function test_SettleRegressionReverts() public {
    vm.prank(alice);
    vault.depositBond{value: 5 * WAD}();
    vm.prank(resolver);
    vault.settle(alice, 3 * WAD);

    vm.expectRevert(
      abi.encodeWithSelector(ReviewBondVault.SettlementRegression.selector, 3 * WAD, 2 * WAD)
    );
    vm.prank(resolver);
    vault.settle(alice, 2 * WAD);
  }

  function test_SettleAboveDepositsReverts() public {
    vm.prank(alice);
    vault.depositBond{value: 5 * WAD}();

    vm.expectRevert(
      abi.encodeWithSelector(ReviewBondVault.SettlementExceedsDeposits.selector, 5 * WAD, 6 * WAD)
    );
    vm.prank(resolver);
    vault.settle(alice, 6 * WAD);
  }

  function test_SettleEqualTotalReverts() public {
    vm.prank(alice);
    vault.depositBond{value: 5 * WAD}();
    vm.prank(resolver);
    vault.settle(alice, 2 * WAD);

    vm.expectRevert(abi.encodeWithSelector(ReviewBondVault.SettlementUnchanged.selector, 2 * WAD));
    vm.prank(resolver);
    vault.settle(alice, 2 * WAD);

    // The never-settled zero total is equally a no-op delta.
    vm.expectRevert(abi.encodeWithSelector(ReviewBondVault.SettlementUnchanged.selector, 0));
    vm.prank(resolver);
    vault.settle(bob, 0);
  }

  // ------------------------------------------------------------- withdrawals

  function test_WithdrawUpToAvailable() public {
    vm.prank(alice);
    vault.depositBond{value: 5 * WAD}();

    uint256 balanceBefore = alice.balance;

    vm.expectEmit(true, true, true, true, address(vault));
    emit ReviewBondVault.ReviewBondWithdrawn(alice, 5 * WAD, 0);
    vm.prank(alice);
    vault.withdrawBond(5 * WAD);

    assertEq(alice.balance, balanceBefore + 5 * WAD);
    assertEq(vault.depositedOf(alice), 0);
    assertEq(vault.availableBond(alice), 0);
    assertEq(address(vault).balance, 0);
  }

  function test_WithdrawOverdrawReverts() public {
    vm.prank(alice);
    vault.depositBond{value: 5 * WAD}();
    vm.prank(resolver);
    vault.settle(alice, 2 * WAD);

    vm.expectRevert(
      abi.encodeWithSelector(
        ReviewBondVault.ReviewBondWithdrawalExceedsAvailable.selector,
        3 * WAD,
        3 * WAD + 1
      )
    );
    vm.prank(alice);
    vault.withdrawBond(3 * WAD + 1);
  }

  function test_WithdrawZeroReverts() public {
    vm.prank(alice);
    vault.depositBond{value: 5 * WAD}();

    vm.expectRevert(ReviewBondVault.InvalidReviewBondWithdrawal.selector);
    vm.prank(alice);
    vault.withdrawBond(0);
  }

  function test_WithdrawAfterSettleLeavesConsumedLocked() public {
    vm.prank(alice);
    vault.depositBond{value: 10 * WAD}();
    vm.prank(resolver);
    vault.settle(alice, 4 * WAD);

    vm.expectEmit(true, true, true, true, address(vault));
    emit ReviewBondVault.ReviewBondWithdrawn(alice, 6 * WAD, 0);
    vm.prank(alice);
    vault.withdrawBond(6 * WAD);

    // Deposits shrink with the withdrawal; the settled consumption stays.
    assertEq(vault.depositedOf(alice), 4 * WAD);
    assertEq(vault.settledConsumedOf(alice), 4 * WAD);
    assertEq(vault.availableBond(alice), 0);
    // The vault still holds exactly the collected-but-unswept fees.
    assertEq(address(vault).balance, vault.collectedFees());
    assertEq(vault.collectedFees(), 4 * WAD);
  }

  function test_SettleAfterWithdrawalBoundsToReducedDeposits() public {
    vm.prank(alice);
    vault.depositBond{value: 10 * WAD}();
    vm.prank(resolver);
    vault.settle(alice, 3 * WAD);
    vm.prank(alice);
    vault.withdrawBond(5 * WAD);

    assertEq(vault.depositedOf(alice), 5 * WAD);

    // Above the reduced deposits: the withdrawn value is gone and can no
    // longer be consumed.
    vm.expectRevert(
      abi.encodeWithSelector(
        ReviewBondVault.SettlementExceedsDeposits.selector,
        5 * WAD,
        5 * WAD + 1
      )
    );
    vm.prank(resolver);
    vault.settle(alice, 5 * WAD + 1);

    // Up to the reduced deposits: the remaining bond is still consumable.
    vm.expectEmit(true, true, true, true, address(vault));
    emit ReviewBondVault.ReviewFeesSettled(alice, 2 * WAD, 5 * WAD);
    vm.prank(resolver);
    vault.settle(alice, 5 * WAD);

    assertEq(vault.availableBond(alice), 0);
    assertEq(vault.collectedFees(), 5 * WAD);
  }

  function test_WithdrawToRejectingCallerReverts() public {
    RejectingRecipient rejector = new RejectingRecipient();
    vm.deal(address(this), 10 * WAD);
    rejector.depositTo{value: 2 * WAD}(vault);

    vm.expectRevert(
      abi.encodeWithSelector(
        ReviewBondVault.ReviewBondWithdrawalFailed.selector,
        address(rejector),
        WAD
      )
    );
    rejector.withdrawFrom(vault, WAD);
  }

  // -------------------------------------------------------------- fee sweeps

  function test_OwnerSweepsCollectedFees() public {
    vm.prank(alice);
    vault.depositBond{value: 5 * WAD}();
    vm.prank(resolver);
    vault.settle(alice, 2 * WAD);

    vm.expectEmit(true, true, true, true, address(vault));
    emit ReviewBondVault.ReviewFeesWithdrawn(treasury, 2 * WAD);
    vault.withdrawCollectedFees(treasury);

    assertEq(treasury.balance, 2 * WAD);
    assertEq(vault.collectedFees(), 0);
    assertEq(address(vault).balance, 3 * WAD);
  }

  function test_SweepByNonOwnerReverts() public {
    address rando = makeAddr("rando");
    vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
    vm.prank(rando);
    vault.withdrawCollectedFees(treasury);
  }

  function test_SweepToZeroRecipientReverts() public {
    vm.expectRevert(ReviewBondVault.InvalidReviewFeeRecipient.selector);
    vault.withdrawCollectedFees(payable(address(0)));
  }

  function test_SweepEmptyPoolReverts() public {
    vm.expectRevert(ReviewBondVault.NoCollectedReviewFees.selector);
    vault.withdrawCollectedFees(treasury);
  }

  function test_SweepToRejectingRecipientReverts() public {
    vm.prank(alice);
    vault.depositBond{value: 5 * WAD}();
    vm.prank(resolver);
    vault.settle(alice, 2 * WAD);

    RejectingRecipient rejector = new RejectingRecipient();
    vm.expectRevert(
      abi.encodeWithSelector(
        ReviewBondVault.ReviewFeeWithdrawalFailed.selector,
        address(rejector),
        2 * WAD
      )
    );
    vault.withdrawCollectedFees(payable(address(rejector)));
  }

  // ---------------------------------------------------------------- resolver

  function test_ResolverRotation() public {
    address nextResolver = makeAddr("next-resolver");
    vm.prank(alice);
    vault.depositBond{value: 5 * WAD}();

    vm.expectEmit(true, true, true, true, address(vault));
    emit ReviewBondVault.SettlementResolverUpdated(nextResolver);
    vault.setResolver(nextResolver);
    assertEq(vault.resolver(), nextResolver);

    // The rotated-out resolver loses the settlement right.
    vm.expectRevert(
      abi.encodeWithSelector(ReviewBondVault.UnauthorizedSettlementResolver.selector, resolver)
    );
    vm.prank(resolver);
    vault.settle(alice, WAD);

    vm.prank(nextResolver);
    vault.settle(alice, WAD);
    assertEq(vault.settledConsumedOf(alice), WAD);
  }

  function test_SetResolverValidatesOwnerAndZeroAccount() public {
    address rando = makeAddr("rando");
    vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, rando));
    vm.prank(rando);
    vault.setResolver(rando);

    vm.expectRevert(ReviewBondVault.InvalidSettlementResolver.selector);
    vault.setResolver(address(0));
  }

  function test_ConstructorRejectsZeroResolver() public {
    vm.expectRevert(ReviewBondVault.InvalidSettlementResolver.selector);
    new ReviewBondVault(address(this), address(0));
  }

  // ---------------------------------------------------------- native custody

  function test_StrayNativeSendReverts() public {
    vm.deal(address(this), 2 * WAD);

    // Plain value transfer: no receive function, so it must revert.
    (bool plainSendOk, ) = address(vault).call{value: WAD}("");
    assertFalse(plainSendOk);

    // Value transfer with unknown calldata: no fallback either.
    (bool dataSendOk, ) = address(vault).call{value: WAD}(hex"deadbeef");
    assertFalse(dataSendOk);

    assertEq(address(vault).balance, 0);
  }

  // --------------------------------------------------------------- invariant

  function test_BalanceInvariantAcrossMixedSequence() public {
    // Every value transfer leaves the vault balance equal to the sum of
    // unconsumed bonds plus the collected pool.
    vm.prank(alice);
    vault.depositBond{value: 10 * WAD}();
    _assertBalanceInvariant();

    vm.prank(bob);
    vault.depositBond{value: 4 * WAD}();
    _assertBalanceInvariant();

    vm.prank(resolver);
    vault.settle(alice, 3 * WAD);
    _assertBalanceInvariant();

    vm.prank(alice);
    vault.withdrawBond(5 * WAD);
    _assertBalanceInvariant();

    vm.prank(resolver);
    vault.settle(bob, 4 * WAD);
    _assertBalanceInvariant();

    vm.prank(resolver);
    vault.settle(alice, 5 * WAD);
    _assertBalanceInvariant();

    vault.withdrawCollectedFees(treasury);
    _assertBalanceInvariant();

    vm.prank(alice);
    vault.depositBond{value: 2 * WAD}();
    _assertBalanceInvariant();

    vm.prank(alice);
    vault.withdrawBond(2 * WAD);
    _assertBalanceInvariant();

    assertEq(vault.availableBond(alice), 0);
    assertEq(vault.availableBond(bob), 0);
    assertEq(vault.collectedFees(), 0);
    assertEq(address(vault).balance, 0);
    // Swept fees: alice 3 + bob 4 + alice 2 more after the withdrawal.
    assertEq(treasury.balance, 9 * WAD);
  }

  function testFuzz_BalanceInvariantAcrossDepositSettleWithdraw(
    uint96 aliceDeposit,
    uint96 bobDeposit,
    uint256 firstSettleSeed,
    uint256 withdrawSeed,
    uint256 secondSettleSeed
  ) public {
    uint256 aliceAmount = bound(uint256(aliceDeposit), 1, 100 * WAD);
    uint256 bobAmount = bound(uint256(bobDeposit), 1, 100 * WAD);

    vm.prank(alice);
    vault.depositBond{value: aliceAmount}();
    _assertBalanceInvariant();

    vm.prank(bob);
    vault.depositBond{value: bobAmount}();
    _assertBalanceInvariant();

    uint256 firstSettle = bound(firstSettleSeed, 0, aliceAmount);
    if (firstSettle > 0) {
      vm.prank(resolver);
      vault.settle(alice, firstSettle);
      _assertBalanceInvariant();
    }

    uint256 withdrawal = bound(withdrawSeed, 0, vault.availableBond(alice));
    if (withdrawal > 0) {
      vm.prank(alice);
      vault.withdrawBond(withdrawal);
      _assertBalanceInvariant();
    }

    // A later settlement is bounded by the withdrawal-reduced deposits.
    uint256 secondSettle = bound(secondSettleSeed, firstSettle, vault.depositedOf(alice));
    if (secondSettle > firstSettle) {
      vm.prank(resolver);
      vault.settle(alice, secondSettle);
      _assertBalanceInvariant();
    }

    if (vault.collectedFees() > 0) {
      vault.withdrawCollectedFees(treasury);
      _assertBalanceInvariant();
    }

    vm.prank(bob);
    vault.withdrawBond(bobAmount);
    _assertBalanceInvariant();
  }

  function _assertBalanceInvariant() private view {
    assertEq(
      address(vault).balance,
      vault.availableBond(alice) + vault.availableBond(bob) + vault.collectedFees()
    );
  }
}
