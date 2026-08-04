// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ReviewBondVault
/// @author Pop Charts
/// @notice Collector for prepaid, **non-refundable** market-review credit in the
///   chain's native token (native USDC on Arc). A depositor names the account the
///   credit belongs to, so paying from a different wallet than the one a draft
///   will be created from cannot strand funds. Review consumption is metered
///   entirely off-chain against the indexed deposit total; the chain records only
///   that value arrived. There is no user withdrawal and no settlement: the owner
///   sweeps the balance, and the contract has no receive or fallback function, so
///   stray native transfers revert and the balance always equals the unswept
///   deposits.
/// @dev Per ADR 0022's "prepaid review credit" amendment, which withdrew the
///   earlier refundable-bond design. That design let a creator withdraw against
///   reviews already consumed (the on-chain withdrawal check read a settled total
///   that lagged the off-chain meter), and the same withdrawal could make
///   settlement revert permanently for that account. Both defects lived in the
///   withdrawal path, so the withdrawal is gone rather than policed. The `Bond`
///   in the contract name is legacy and is renamed with the rest of the
///   `review_bond_*` surface in its own pass.
contract ReviewBondVault is Ownable, ReentrancyGuard {
  /// @notice Reverts when a deposit carries no native value.
  error InvalidReviewCreditDeposit();
  /// @notice Reverts when a deposit names the zero account as beneficiary.
  error InvalidReviewCreditBeneficiary();
  /// @notice Reverts when owner fee withdrawal targets the zero account.
  error InvalidReviewFeeRecipient();
  /// @notice Reverts when owner fee withdrawal finds no collected review fees.
  error NoCollectedReviewFees();
  /// @notice Reverts when the native fee transfer to the recipient fails.
  /// @param recipient Account that should have received the fees.
  /// @param amount Fee amount attempted.
  error ReviewFeeWithdrawalFailed(address recipient, uint256 amount);

  /// @notice Emitted when native value is credited to an account's review credit.
  /// @param user Account the credit belongs to, named by the depositor.
  /// @param payer Account that actually sent the value.
  /// @param amount Native amount deposited.
  /// @param totalDeposited Lifetime deposits recorded for the user after this deposit.
  event ReviewBondDeposited(
    address indexed user,
    address indexed payer,
    uint256 amount,
    uint256 totalDeposited
  );

  /// @notice Emitted when the owner sweeps collected review fees.
  /// @param recipient Account receiving the fees.
  /// @param amount Fee amount withdrawn.
  event ReviewFeesWithdrawn(address indexed recipient, uint256 amount);

  mapping(address user => uint256 amount) private _deposited;

  /// @notice Deploys the vault with its owner.
  /// @param initialOwner Account that sweeps collected fees.
  constructor(address initialOwner) Ownable(initialOwner) {}

  /// @notice Credits the sent native value to `beneficiary`'s review credit.
  /// @dev The beneficiary is a parameter rather than `msg.sender` because credit
  ///   is non-refundable and nothing can move a balance afterwards: a creator
  ///   holding both an embedded and an external wallet would otherwise be one
  ///   mis-selected wallet away from an unrecoverable payment. Deliberately no
  ///   owner-side reassignment exists — a privileged "move user funds" call is a
  ///   worse audit surface than the mistake it would clean up after.
  /// @param beneficiary Account the credit belongs to.
  function depositFor(address beneficiary) external payable {
    if (beneficiary == address(0)) {
      revert InvalidReviewCreditBeneficiary();
    }
    if (msg.value == 0) {
      revert InvalidReviewCreditDeposit();
    }

    uint256 totalDeposited = _deposited[beneficiary] + msg.value;
    _deposited[beneficiary] = totalDeposited;

    emit ReviewBondDeposited(beneficiary, msg.sender, msg.value, totalDeposited);
  }

  /// @notice Sweeps the whole collected balance to the recipient.
  /// @dev Every deposit is collected the moment it lands — credit is
  ///   non-refundable, so there is no user-owed portion to hold back. The sweep
  ///   can therefore take value covering reviews not yet delivered, which is
  ///   inherent to prepayment and accepted at this price point.
  /// @param recipient Account receiving the fees.
  function withdrawCollectedFees(address payable recipient) external onlyOwner nonReentrant {
    if (recipient == address(0)) {
      revert InvalidReviewFeeRecipient();
    }

    uint256 amount = address(this).balance;
    if (amount == 0) {
      revert NoCollectedReviewFees();
    }

    (bool success, ) = recipient.call{value: amount}("");
    if (!success) {
      revert ReviewFeeWithdrawalFailed(recipient, amount);
    }

    emit ReviewFeesWithdrawn(recipient, amount);
  }

  /// @notice Returns an account's lifetime review-credit deposits.
  /// @dev Lifetime, not remaining: consumption is metered off-chain, so the
  ///   chain cannot say what is left. The submission gate subtracts the metered
  ///   charges from this figure.
  /// @param user Account whose deposits are queried.
  /// @return Lifetime deposits recorded for the user.
  function depositedOf(address user) external view returns (uint256) {
    return _deposited[user];
  }

  /// @notice Returns the balance available for the owner to sweep.
  /// @return Fee amount collected and not yet withdrawn.
  function collectedFees() external view returns (uint256) {
    return address(this).balance;
  }
}
