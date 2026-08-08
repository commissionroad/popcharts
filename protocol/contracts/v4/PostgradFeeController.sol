// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

// solhint-disable immutable-vars-naming

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Currency} from "@uniswap/v4-periphery/lib/v4-core/src/types/Currency.sol";
import {IProtocolFees} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IProtocolFees.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolKey.sol";

/// @title ICompleteSetMergeMarket
/// @author Pop Charts
/// @notice The complete-set merge surface of CompleteSetBinaryMarket, as the
///   fee controller consumes it. Declared here instead of importing the market:
///   the market pins `pragma ^0.8.28` while this contract must also compile at
///   0.8.26 in compilation units that include the venue PoolManager (whose
///   closure pins solidity 0.8.26 exactly). The merge test suite drives a real
///   CompleteSetBinaryMarket through this interface, so signature drift fails
///   tests rather than lingering.
interface ICompleteSetMergeMarket {
  /// @notice YES outcome token of the market.
  function yesToken() external view returns (IERC20);

  /// @notice NO outcome token of the market.
  function noToken() external view returns (IERC20);

  /// @notice Decimal precision used by YES and NO tokens.
  function outcomeDecimals() external view returns (uint8);

  /// @notice Decimal precision used by the collateral token.
  function collateralDecimals() external view returns (uint8);

  /// @notice Burns equal YES and NO from the caller and pays the caller collateral.
  /// @param outcomeAmount YES and NO amount to burn.
  /// @return collateralAmount Collateral paid to the caller.
  function mergeCompleteSets(uint256 outcomeAmount) external returns (uint256 collateralAmount);
}

/// @title PostgradFeeController
/// @author Pop Charts
/// @notice Protocol-fee controller for the post-graduation venue (ADR 0014 §5,
///   docs/fee-model.md): the address the venue PoolManager recognizes for
///   setting the native per-pool protocol fee and sweeping its per-currency
///   accrual. The venue's own collect call emits no event, so every sweep out
///   of the venue — and every later movement out of this contract — emits a
///   first-party event here to keep the money paper trail intact. Swept fees
///   from outcome-token inputs (sells) are paired and merged back to
///   collateral before resolution, because the losing side goes to zero.
///   Nothing arms automatically: arming each pool is an owner ops action,
///   consistent with the entry fee shipping disarmed.
contract PostgradFeeController is Ownable, ReentrancyGuard {
  using PoolIdLibrary for PoolKey;
  using SafeERC20 for IERC20;

  /// @notice Cap on each direction's protocol fee, in pips of the input amount.
  /// @dev Mirrors `MAX_PROTOCOL_FEE` in the vendored v4-core ProtocolFeeLibrary
  ///   (source attribution: Uniswap v4-core), which cannot be imported because
  ///   it pins solidity 0.8.26 exactly and this contract must also compile in
  ///   0.8.28 units with the complete-set market. The vendored package is
  ///   version-pinned, so the mirror cannot drift silently; arming tests
  ///   observe the venue accepting `SYMMETRIC_PROTOCOL_FEE` on-chain, which
  ///   fails if the venue's cap ever drops below this value.
  uint16 public constant MAX_PROTOCOL_FEE_PIPS = 1000;

  /// @notice Bit width of one direction's fee inside the packed uint24.
  uint8 private constant ONE_FOR_ZERO_FEE_SHIFT = 12;

  /// @notice Mask of one direction's fee inside the packed uint24.
  uint24 private constant DIRECTION_FEE_MASK = 0xfff;

  /// @notice Packed symmetric 0.1% protocol fee — the maximum in both
  ///   directions: `1000 | (1000 << 12)` (= 4_097_000).
  uint24 public constant SYMMETRIC_PROTOCOL_FEE =
    uint24(MAX_PROTOCOL_FEE_PIPS) | (uint24(MAX_PROTOCOL_FEE_PIPS) << ONE_FOR_ZERO_FEE_SHIFT);

  /// @notice Reverts when the venue pool manager address is zero.
  error InvalidPoolManager();
  /// @notice Reverts when a sweep or withdrawal targets the zero account.
  error InvalidFeeRecipient();
  /// @notice Reverts when a withdrawal amount is zero.
  error InvalidWithdrawalAmount();
  /// @notice Reverts when batch arming receives no pool keys.
  error EmptyPoolKeyBatch();
  /// @notice Reverts when a packed fee exceeds the per-direction cap. Checked
  ///   here before the venue's own validation so a misconfigured arming fails
  ///   with a first-party error instead of a venue revert.
  /// @param protocolFee Packed fee that was rejected.
  /// @param directionCap Cap each 12-bit direction must not exceed.
  error ProtocolFeeExceedsDirectionCap(uint24 protocolFee, uint16 directionCap);
  /// @notice Reverts when a sweep finds no accrued fees for the currency.
  /// @param currency Currency with an empty accrual.
  error NoFeesToSweep(Currency currency);
  /// @notice Reverts when a merge finds no pairable YES/NO balance.
  /// @param market Market whose outcome tokens were checked.
  error NoOutcomeFeesToMerge(address market);

  /// @notice Emitted when a pool's native protocol fee is armed (or re-armed).
  /// @param poolId Pool whose fee was set.
  /// @param protocolFee Packed directional fee now active.
  event PoolProtocolFeeArmed(PoolId indexed poolId, uint24 protocolFee);

  /// @notice Emitted when accrued protocol fees are swept out of the venue.
  ///   The venue transfer itself emits nothing, so this event is the
  ///   paper-trail record of the sweep.
  /// @param currency Currency swept.
  /// @param recipient Account that received the full accrual.
  /// @param amount Amount swept.
  event ProtocolFeesSwept(Currency indexed currency, address indexed recipient, uint256 amount);

  /// @notice Emitted when held YES/NO fee tokens are paired and merged back to
  ///   collateral.
  /// @param market Market whose complete sets were merged.
  /// @param outcomeAmount Equal YES and NO amount burned.
  /// @param collateralAmount Collateral this contract received for the pair.
  event OutcomeFeesMerged(address indexed market, uint256 outcomeAmount, uint256 collateralAmount);

  /// @notice Emitted when the owner moves tokens held by this contract —
  ///   merged collateral, an unpaired outcome remainder, or fees swept here.
  /// @param token Token withdrawn.
  /// @param recipient Account receiving the tokens.
  /// @param amount Amount withdrawn.
  event FeeTokensWithdrawn(address indexed token, address indexed recipient, uint256 amount);

  /// @notice Venue pool manager this controller arms and sweeps.
  IProtocolFees public immutable poolManager;

  /// @notice Records the venue pool manager and the operating owner.
  /// @param poolManager_ Venue pool manager to control.
  /// @param initialOwner Owner allowed to arm, sweep, merge, and withdraw.
  constructor(IProtocolFees poolManager_, address initialOwner) Ownable(initialOwner) {
    if (address(poolManager_) == address(0)) {
      revert InvalidPoolManager();
    }

    poolManager = poolManager_;
  }

  /// @notice Arms one pool's native protocol fee.
  /// @param key Pool to arm.
  /// @param protocolFee Packed directional fee, each 12-bit direction at most
  ///   `MAX_PROTOCOL_FEE_PIPS`; `SYMMETRIC_PROTOCOL_FEE` is the standard rate.
  function armPoolProtocolFee(PoolKey calldata key, uint24 protocolFee) external onlyOwner {
    _armPoolProtocolFee(key, protocolFee);
  }

  /// @notice Arms several pools with the same native protocol fee — the
  ///   per-market shape, where YES and NO pools arm together.
  /// @param keys Pools to arm.
  /// @param protocolFee Packed directional fee applied to every pool.
  function armPoolProtocolFeeBatch(PoolKey[] calldata keys, uint24 protocolFee) external onlyOwner {
    if (keys.length == 0) {
      revert EmptyPoolKeyBatch();
    }

    for (uint256 i = 0; i < keys.length; ++i) {
      _armPoolProtocolFee(keys[i], protocolFee);
    }
  }

  /// @notice Sweeps the full accrual of one currency out of the venue and
  ///   emits the paper-trail event the venue's own transfer lacks.
  /// @dev Run in its own transaction, never inside an unlock/settle cycle:
  ///   the venue reverts with `ProtocolFeeCurrencySynced` when the currency is
  ///   mid-sync. Sweep outcome-token currencies to this contract so
  ///   `mergeOutcomeFees` can pair them before resolution.
  /// @param currency Currency to sweep.
  /// @param recipient Account receiving the full accrual.
  /// @return amount Amount swept.
  function sweepProtocolFees(
    Currency currency,
    address recipient
  ) external onlyOwner nonReentrant returns (uint256 amount) {
    if (recipient == address(0)) {
      revert InvalidFeeRecipient();
    }

    amount = poolManager.collectProtocolFees(recipient, currency, 0);
    if (amount == 0) {
      revert NoFeesToSweep(currency);
    }

    emit ProtocolFeesSwept(currency, recipient, amount);
  }

  /// @notice Pairs this contract's YES and NO holdings for a market and merges
  ///   `min(yes, no)` back to exact collateral, which the market pays to this
  ///   contract. Outcome-token fees must not sit until resolution — the losing
  ///   side goes to zero — and merging is free and open until then
  ///   (docs/fee-model.md). The unpaired remainder stays here for
  ///   `withdrawFeeTokens`.
  /// @param market Market whose outcome tokens this contract holds.
  /// @return outcomeAmount Equal YES and NO amount merged.
  /// @return collateralAmount Collateral received for the pair.
  function mergeOutcomeFees(
    ICompleteSetMergeMarket market
  ) external onlyOwner nonReentrant returns (uint256 outcomeAmount, uint256 collateralAmount) {
    uint256 yesBalance = market.yesToken().balanceOf(address(this));
    uint256 noBalance = market.noToken().balanceOf(address(this));
    outcomeAmount = yesBalance < noBalance ? yesBalance : noBalance;

    // The market's merge converts outcome units to collateral units and
    // rejects amounts that do not divide exactly, so floor the pair to the
    // conversion grid when outcome tokens carry more decimals than collateral.
    uint8 outcomeDecimals = market.outcomeDecimals();
    uint8 collateralDecimals = market.collateralDecimals();
    if (outcomeDecimals > collateralDecimals) {
      uint256 factor = 10 ** uint256(outcomeDecimals - collateralDecimals);
      outcomeAmount -= outcomeAmount % factor;
    }
    if (outcomeAmount == 0) {
      revert NoOutcomeFeesToMerge(address(market));
    }

    collateralAmount = market.mergeCompleteSets(outcomeAmount);

    emit OutcomeFeesMerged(address(market), outcomeAmount, collateralAmount);
  }

  /// @notice Withdraws tokens held by this contract — merged collateral, an
  ///   unpaired outcome remainder, or fees swept here. Swept post-graduation
  ///   fees are protocol money, so owner-directed disposition is sound (unlike
  ///   the pre-graduation entry fee, which may owe refunds); the event keeps
  ///   the movement on the paper trail.
  /// @param token Token to withdraw.
  /// @param recipient Account receiving the tokens.
  /// @param amount Amount to withdraw.
  function withdrawFeeTokens(
    IERC20 token,
    address recipient,
    uint256 amount
  ) external onlyOwner nonReentrant {
    if (recipient == address(0)) {
      revert InvalidFeeRecipient();
    }
    if (amount == 0) {
      revert InvalidWithdrawalAmount();
    }

    token.safeTransfer(recipient, amount);

    emit FeeTokensWithdrawn(address(token), recipient, amount);
  }

  /// @notice Validates both fee directions against the cap, then arms the pool.
  /// @param key Pool to arm.
  /// @param protocolFee Packed directional fee.
  function _armPoolProtocolFee(PoolKey calldata key, uint24 protocolFee) private {
    uint16 zeroForOneFee = uint16(protocolFee & DIRECTION_FEE_MASK);
    uint16 oneForZeroFee = uint16(protocolFee >> ONE_FOR_ZERO_FEE_SHIFT);
    if (zeroForOneFee > MAX_PROTOCOL_FEE_PIPS || oneForZeroFee > MAX_PROTOCOL_FEE_PIPS) {
      revert ProtocolFeeExceedsDirectionCap(protocolFee, MAX_PROTOCOL_FEE_PIPS);
    }

    poolManager.setProtocolFee(key, protocolFee);

    emit PoolProtocolFeeArmed(key.toId(), protocolFee);
  }
}
