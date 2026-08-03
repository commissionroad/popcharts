// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title ReviewBondVault
/// @author Pop Charts
/// @notice Standalone escrow for prepaid, refundable market-review bonds in the
///   chain's native token (native USDC on Arc). Review consumption is metered
///   off-chain against the bonded balance; an owner-set resolver attests each
///   user's monotonic lifetime consumed total on-chain, moving the newly
///   consumed delta into a collected pool the owner sweeps. No slashing exists:
///   a user can always withdraw the unconsumed remainder. The contract has no
///   receive or fallback function, so stray native transfers revert and the
///   balance always equals the sum of unconsumed bonds plus the collected pool.
contract ReviewBondVault is Ownable, ReentrancyGuard {
  /// @notice Reverts when owner configuration sets the zero resolver account.
  error InvalidSettlementResolver();
  /// @notice Reverts when settlement is attempted by an account that is not the resolver.
  /// @param account Unauthorized account.
  error UnauthorizedSettlementResolver(address account);
  /// @notice Reverts when a bond deposit carries no native value.
  error InvalidReviewBondDeposit();
  /// @notice Reverts when a settlement reports less lifetime consumption than already settled.
  /// @param settledConsumed Lifetime consumed total already settled for the user.
  /// @param consumedTotal Lifetime consumed total reported by the resolver.
  error SettlementRegression(uint256 settledConsumed, uint256 consumedTotal);
  /// @notice Reverts when a settlement repeats the already-settled lifetime consumed total.
  /// @param consumedTotal Lifetime consumed total reported by the resolver.
  error SettlementUnchanged(uint256 consumedTotal);
  /// @notice Reverts when a settlement reports more consumption than the user ever deposited.
  /// @param deposited Lifetime deposits recorded for the user.
  /// @param consumedTotal Lifetime consumed total reported by the resolver.
  error SettlementExceedsDeposits(uint256 deposited, uint256 consumedTotal);
  /// @notice Reverts when a bond withdrawal requests no value.
  error InvalidReviewBondWithdrawal();
  /// @notice Reverts when a bond withdrawal exceeds the caller's unconsumed bond.
  /// @param available Unconsumed bond available for withdrawal.
  /// @param requested Bond amount requested by the caller.
  error ReviewBondWithdrawalExceedsAvailable(uint256 available, uint256 requested);
  /// @notice Reverts when the native bond transfer to the withdrawing user fails.
  /// @param recipient Account that should have received the bond.
  /// @param amount Bond amount attempted.
  error ReviewBondWithdrawalFailed(address recipient, uint256 amount);
  /// @notice Reverts when owner fee withdrawal targets the zero account.
  error InvalidReviewFeeRecipient();
  /// @notice Reverts when owner fee withdrawal finds no collected review fees.
  error NoCollectedReviewFees();
  /// @notice Reverts when the native fee transfer to the recipient fails.
  /// @param recipient Account that should have received the fees.
  /// @param amount Fee amount attempted.
  error ReviewFeeWithdrawalFailed(address recipient, uint256 amount);

  /// @notice Emitted when a user deposits native value into their review bond.
  /// @param user Account whose bond was credited.
  /// @param amount Native amount deposited.
  /// @param totalDeposited Lifetime deposits recorded for the user after this deposit.
  event ReviewBondDeposited(address indexed user, uint256 amount, uint256 totalDeposited);

  /// @notice Emitted when the resolver settles a user's off-chain-metered review consumption.
  /// @param user Account whose consumption was settled.
  /// @param consumedDelta Newly consumed amount moved into the collected pool.
  /// @param consumedTotal Lifetime consumed total recorded for the user after this settlement.
  event ReviewFeesSettled(address indexed user, uint256 consumedDelta, uint256 consumedTotal);

  /// @notice Emitted when a user withdraws unconsumed bond.
  /// @param user Account whose bond was withdrawn.
  /// @param amount Native amount withdrawn.
  /// @param remainingAvailable Unconsumed bond remaining after this withdrawal.
  event ReviewBondWithdrawn(address indexed user, uint256 amount, uint256 remainingAvailable);

  /// @notice Emitted when the owner sweeps the collected review fees.
  /// @param recipient Account receiving the fees.
  /// @param amount Fee amount withdrawn.
  event ReviewFeesWithdrawn(address indexed recipient, uint256 amount);

  /// @notice Emitted when the settlement resolver is set.
  /// @param resolver Account authorized to settle review consumption.
  event SettlementResolverUpdated(address indexed resolver);

  address private _resolver;
  uint256 private _collectedReviewFees;
  mapping(address user => uint256 amount) private _deposited;
  mapping(address user => uint256 amount) private _settledConsumed;

  /// @notice Restricts settlement to the owner-set resolver account.
  modifier onlyResolver() {
    if (msg.sender != _resolver) {
      revert UnauthorizedSettlementResolver(msg.sender);
    }
    _;
  }

  /// @notice Deploys the vault with its owner and settlement resolver.
  /// @param initialOwner Account that administers the resolver and sweeps fees.
  /// @param initialResolver Account authorized to settle review consumption.
  constructor(address initialOwner, address initialResolver) Ownable(initialOwner) {
    if (initialResolver == address(0)) {
      revert InvalidSettlementResolver();
    }

    _resolver = initialResolver;
    emit SettlementResolverUpdated(initialResolver);
  }

  /// @notice Credits the sent native value to the caller's review bond.
  function depositBond() external payable {
    if (msg.value == 0) {
      revert InvalidReviewBondDeposit();
    }

    uint256 totalDeposited = _deposited[msg.sender] + msg.value;
    _deposited[msg.sender] = totalDeposited;

    emit ReviewBondDeposited(msg.sender, msg.value, totalDeposited);
  }

  /// @notice Records a user's off-chain-metered lifetime consumed total and
  ///   moves the newly consumed delta into the collected pool. Idempotence is
  ///   deliberate: replaying an already-settled total reverts instead of
  ///   double-charging, and a regressing total reverts because the meter only
  ///   moves forward.
  /// @param user Account whose consumption is being settled.
  /// @param consumedTotal New lifetime consumed total for the user.
  function settle(address user, uint256 consumedTotal) external onlyResolver {
    uint256 settledConsumed = _settledConsumed[user];
    if (consumedTotal < settledConsumed) {
      revert SettlementRegression(settledConsumed, consumedTotal);
    }
    if (consumedTotal == settledConsumed) {
      revert SettlementUnchanged(consumedTotal);
    }

    uint256 deposited = _deposited[user];
    if (consumedTotal > deposited) {
      revert SettlementExceedsDeposits(deposited, consumedTotal);
    }

    uint256 consumedDelta = consumedTotal - settledConsumed;
    _settledConsumed[user] = consumedTotal;
    _collectedReviewFees += consumedDelta;

    emit ReviewFeesSettled(user, consumedDelta, consumedTotal);
  }

  /// @notice Withdraws unconsumed bond to the caller. Decreases the caller's
  ///   recorded deposits so `deposited − settledConsumed` always equals the
  ///   remaining unconsumed bond and never underflows.
  /// @param amount Native amount to withdraw.
  function withdrawBond(uint256 amount) external nonReentrant {
    if (amount == 0) {
      revert InvalidReviewBondWithdrawal();
    }

    uint256 available = _deposited[msg.sender] - _settledConsumed[msg.sender];
    if (amount > available) {
      revert ReviewBondWithdrawalExceedsAvailable(available, amount);
    }

    _deposited[msg.sender] -= amount;
    (bool success, ) = payable(msg.sender).call{value: amount}("");
    if (!success) {
      revert ReviewBondWithdrawalFailed(msg.sender, amount);
    }

    emit ReviewBondWithdrawn(msg.sender, amount, available - amount);
  }

  /// @notice Sweeps the whole collected review-fee pool to the recipient.
  /// @param recipient Account receiving the fees.
  function withdrawCollectedFees(address payable recipient) external onlyOwner nonReentrant {
    if (recipient == address(0)) {
      revert InvalidReviewFeeRecipient();
    }

    uint256 amount = _collectedReviewFees;
    if (amount == 0) {
      revert NoCollectedReviewFees();
    }

    _collectedReviewFees = 0;
    (bool success, ) = recipient.call{value: amount}("");
    if (!success) {
      revert ReviewFeeWithdrawalFailed(recipient, amount);
    }

    emit ReviewFeesWithdrawn(recipient, amount);
  }

  /// @notice Sets the account authorized to settle review consumption.
  /// @param newResolver Account authorized to settle review consumption.
  function setResolver(address newResolver) external onlyOwner {
    if (newResolver == address(0)) {
      revert InvalidSettlementResolver();
    }

    _resolver = newResolver;
    emit SettlementResolverUpdated(newResolver);
  }

  /// @notice Returns the account authorized to settle review consumption.
  /// @return Account authorized to settle review consumption.
  function resolver() external view returns (address) {
    return _resolver;
  }

  /// @notice Returns a user's unconsumed bond available for withdrawal.
  /// @param user Account whose bond is queried.
  /// @return Unconsumed bond available for withdrawal.
  function availableBond(address user) external view returns (uint256) {
    return _deposited[user] - _settledConsumed[user];
  }

  /// @notice Returns a user's settled lifetime consumed total.
  /// @param user Account whose settled consumption is queried.
  /// @return Lifetime consumed total settled by the resolver.
  function settledConsumedOf(address user) external view returns (uint256) {
    return _settledConsumed[user];
  }

  /// @notice Returns a user's recorded lifetime deposits, net of withdrawals.
  /// @param user Account whose deposits are queried.
  /// @return Lifetime deposits recorded for the user, net of withdrawals.
  function depositedOf(address user) external view returns (uint256) {
    return _deposited[user];
  }

  /// @notice Returns collected review fees not yet withdrawn by the owner.
  /// @return Fee amount collected and not yet withdrawn.
  function collectedFees() external view returns (uint256) {
    return _collectedReviewFees;
  }
}
