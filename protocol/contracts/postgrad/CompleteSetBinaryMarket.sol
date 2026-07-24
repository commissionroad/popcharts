// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable immutable-vars-naming

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {OutcomeToken} from "./OutcomeToken.sol";
import {MarketTypes} from "../types/MarketTypes.sol";

/// @title CompleteSetBinaryMarket
/// @author Pop Charts
/// @notice Fully collateralized ERC20 YES/NO complete-set market for post-graduation trading.
contract CompleteSetBinaryMarket is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  uint8 private constant MAX_SUPPORTED_DECIMALS = 77;

  /// @notice Post-graduation market lifecycle. New states are appended (out of
  /// lifecycle order) so the numeric values of pre-dispute statuses stay stable
  /// for indexers and tooling that decode them.
  enum Status {
    /// @notice Outcome tokens can mint, merge, trade, and receive retained claims.
    Trading,
    /// @notice A winning side has been selected and winning tokens can redeem.
    Resolved,
    /// @notice The market ended without a binary resolution and tokens redeem at draw value.
    Cancelled,
    /// @notice A resolution is proposed and publicly disputable until the window closes.
    ResolutionPending
  }

  /// @notice Per-market resolution timing and dispute parameters, bundled into a
  /// struct because the constructor is at the EVM stack limit (protocol ADR 0013).
  struct ResolutionConfig {
    /// @notice Earliest timestamp a YES resolution may be proposed.
    uint64 yesNotBefore;
    /// @notice Earliest timestamp a NO resolution may be proposed.
    uint64 noNotBefore;
    /// @notice Seconds a proposed resolution stays publicly disputable. Zero
    /// disables the optimistic flow and keeps direct single-step resolve().
    uint64 disputeWindow;
    /// @notice Collateral amount (raw units) a non-resolver disputer must bond.
    /// Stamped at deployment; consumed once dispute() ships (ADR 0013).
    uint256 disputeBond;
  }

  /// @notice Reverts when the collateral token is the zero address.
  error InvalidCollateral();
  /// @notice Reverts when retained-claim minting has no authorized caller.
  error InvalidRetainedMinter();
  /// @notice Reverts when resolution has no authorized caller.
  error InvalidResolver();
  /// @notice Reverts when a token recipient is the zero address.
  error InvalidRecipient();
  /// @notice Reverts when a token or collateral amount is zero.
  error InvalidAmount();
  /// @notice Reverts when a token's decimals can overflow scale factors.
  /// @param tokenDecimals Decimals value that is too large for conversion helpers.
  error UnsupportedDecimals(uint8 tokenDecimals);
  /// @notice Reverts when a conversion would silently round away raw units.
  /// @param amount Amount that cannot be converted exactly.
  /// @param factor Scale factor that the amount must divide evenly by.
  error AmountHasDust(uint256 amount, uint256 factor);
  /// @notice Reverts when an ERC20 transfer delivers less or more collateral than expected.
  /// @param expected Exact collateral amount that should have reached the market.
  /// @param received Actual collateral amount observed by balance delta.
  error InvalidCollateralTransfer(uint256 expected, uint256 received);
  /// @notice Reverts when an account is not allowed to mint retained claim tokens.
  /// @param account Unauthorized account.
  error UnauthorizedRetainedMinter(address account);
  /// @notice Reverts when an account is not allowed to resolve or cancel the market.
  /// @param account Unauthorized account.
  error UnauthorizedResolver(address account);
  /// @notice Reverts when resolve() is called before the earliest resolution time.
  /// @param notBefore Earliest timestamp the attempted resolution is permitted.
  error TooEarlyToResolve(uint64 notBefore);
  /// @notice Reverts when a function is called in the wrong market status.
  /// @param actual Current market status.
  /// @param expected Required market status.
  error InvalidStatus(Status actual, Status expected);
  /// @notice Reverts when a user tries to redeem the losing side after resolution.
  /// @param side Side submitted for redemption.
  /// @param winningSide Side that won the market.
  error LosingSideCannotRedeem(MarketTypes.Side side, MarketTypes.Side winningSide);
  /// @notice Reverts when unresolved backing cannot cover the larger outcome supply.
  /// @param availableOutcomeCapacity Outcome-token capacity represented by escrowed collateral.
  /// @param requiredOutcomeCapacity Larger of YES and NO token supply.
  error InsolventOutcomeBacking(uint256 availableOutcomeCapacity, uint256 requiredOutcomeCapacity);
  /// @notice Reverts when cancelled-market backing cannot cover remaining draw redemptions.
  /// @param availableCollateral Collateral still held by the market.
  /// @param requiredCollateral Collateral required for remaining draw redemptions.
  error InsolventCancelBacking(uint256 availableCollateral, uint256 requiredCollateral);
  /// @notice Reverts when resolve() is called from Trading while a dispute window
  /// is configured — the optimistic propose/finalize flow must be used instead.
  error MarketNotDirectlyResolvable();
  /// @notice Reverts when finalizeResolution() is called before the window closes.
  /// @param deadline Timestamp at which the proposal becomes finalizable.
  error DisputeWindowStillOpen(uint64 deadline);
  /// @notice Reverts when a function requires one of several statuses.
  /// @param actual Current market status.
  error InvalidStatusForAction(Status actual);

  /// @notice Emitted when collateral mints equal YES and NO complete sets.
  /// @param caller Account that supplied collateral.
  /// @param to Recipient of minted YES and NO tokens.
  /// @param collateralAmount Collateral deposited into the market.
  /// @param outcomeAmount YES and NO amount minted to `to`.
  event CompleteSetsMinted(
    address indexed caller,
    address indexed to,
    uint256 collateralAmount,
    uint256 outcomeAmount
  );

  /// @notice Emitted when equal YES and NO tokens merge back into collateral.
  /// @param account Account that burned complete-set tokens.
  /// @param collateralAmount Collateral returned to the account.
  /// @param outcomeAmount YES and NO amount burned.
  event CompleteSetsMerged(
    address indexed account,
    uint256 collateralAmount,
    uint256 outcomeAmount
  );

  /// @notice Emitted when matched graduation collateral funds retained-claim capacity.
  /// @param caller Authorized retained minter that supplied collateral.
  /// @param collateralAmount Collateral deposited into the market.
  /// @param outcomeCapacity Outcome-token capacity represented by the collateral deposit.
  event RetainedCollateralFunded(
    address indexed caller,
    uint256 collateralAmount,
    uint256 outcomeCapacity
  );

  /// @notice Emitted when a retained claim mints one side of the market.
  /// @param to Recipient of retained outcome tokens.
  /// @param side YES or NO side minted.
  /// @param outcomeAmount Outcome token amount minted.
  event RetainedSideMinted(
    address indexed to,
    MarketTypes.Side indexed side,
    uint256 outcomeAmount
  );

  /// @notice Emitted when the resolver proposes a resolution, opening the window.
  /// @param side Proposed winning outcome side.
  /// @param disputeDeadline Timestamp at which the proposal becomes finalizable.
  event ResolutionProposed(MarketTypes.Side indexed side, uint64 disputeDeadline);

  /// @notice Emitted when the market resolves to one winning side.
  /// @param side Winning outcome side.
  event MarketResolved(MarketTypes.Side indexed side);

  /// @notice Emitted when the market is cancelled and tokens redeem at draw value.
  event MarketCancelled();

  /// @notice Emitted when winning tokens redeem after resolution.
  /// @param account Account that redeemed winning tokens.
  /// @param side Winning side burned.
  /// @param outcomeAmount Winning token amount burned.
  /// @param collateralAmount Collateral paid to the account.
  event Redeemed(
    address indexed account,
    MarketTypes.Side indexed side,
    uint256 outcomeAmount,
    uint256 collateralAmount
  );

  /// @notice Emitted when tokens redeem at draw value after cancellation.
  /// @param account Account that redeemed cancelled-market tokens.
  /// @param yesAmount YES token amount burned.
  /// @param noAmount NO token amount burned.
  /// @param collateralAmount Collateral paid to the account.
  event CancelledRedeemed(
    address indexed account,
    uint256 yesAmount,
    uint256 noAmount,
    uint256 collateralAmount
  );

  /// @notice Collateral token backing this market.
  IERC20 public immutable collateralToken;
  /// @notice YES outcome token.
  OutcomeToken public immutable yesToken;
  /// @notice NO outcome token.
  OutcomeToken public immutable noToken;
  /// @notice Decimal precision used by the collateral token.
  uint8 public immutable collateralDecimals;
  /// @notice Decimal precision used by YES and NO tokens.
  uint8 public immutable outcomeDecimals;
  /// @notice Authorized adapter or factory account for retained claim funding and mints.
  address public immutable retainedMinter;
  /// @notice Authorized account for resolution or cancellation in this testnet slice.
  address public immutable resolver;
  /// @notice Earliest timestamp a YES resolution may be submitted (the pregrad
  /// yesNotBefore gate). `cancel` is intentionally not gated, so postponed or
  /// abandoned markets can still be cancelled before this time.
  uint64 public immutable yesNotBefore;
  /// @notice Earliest timestamp a NO resolution may be submitted (the pregrad
  /// resolutionTime deadline). NO is only certain once the full window elapses,
  /// so it is gated no earlier than YES; `cancel` remains ungated.
  uint64 public immutable noNotBefore;
  /// @notice Seconds a proposed resolution stays publicly disputable. Zero keeps
  /// the legacy direct resolve() path (local/dev degeneration, protocol ADR 0013).
  uint64 public immutable disputeWindow;
  /// @notice Collateral bond (raw units) required from a non-resolver disputer.
  uint256 public immutable disputeBond;
  /// @notice Current lifecycle status for this post-graduation market.
  Status public status;
  /// @notice Timestamp of the current resolution proposal (zero before any).
  uint64 public proposedAt;

  MarketTypes.Side private _winningSide;
  MarketTypes.Side private _proposedSide;

  /// @notice Initializes the market, deploys YES/NO tokens, and records privileged callers.
  /// @param collateralToken_ ERC20 collateral token backing fixed-payout claims.
  /// @param owner_ Owner recorded for operational visibility and future factory handoff.
  /// @param retainedMinter_ Account allowed to fund and mint retained claim balances.
  /// @param resolver_ Account allowed to resolve or cancel the market.
  /// @param marketName_ Human-readable market name prefix for outcome token names.
  /// @param marketSymbol_ Short market symbol prefix for outcome token symbols.
  /// @param outcomeDecimals_ Decimal precision for YES and NO outcome tokens.
  /// @param resolutionConfig_ Per-side time gates plus dispute window and bond.
  constructor(
    address collateralToken_,
    address owner_,
    address retainedMinter_,
    address resolver_,
    string memory marketName_,
    string memory marketSymbol_,
    uint8 outcomeDecimals_,
    ResolutionConfig memory resolutionConfig_
  ) Ownable(owner_) {
    if (collateralToken_ == address(0)) {
      revert InvalidCollateral();
    }
    if (retainedMinter_ == address(0)) {
      revert InvalidRetainedMinter();
    }
    if (resolver_ == address(0)) {
      revert InvalidResolver();
    }
    if (outcomeDecimals_ > MAX_SUPPORTED_DECIMALS) {
      revert UnsupportedDecimals(outcomeDecimals_);
    }

    uint8 collateralDecimals_ = IERC20Metadata(collateralToken_).decimals();
    if (collateralDecimals_ > MAX_SUPPORTED_DECIMALS) {
      revert UnsupportedDecimals(collateralDecimals_);
    }

    collateralToken = IERC20(collateralToken_);
    collateralDecimals = collateralDecimals_;
    outcomeDecimals = outcomeDecimals_;
    retainedMinter = retainedMinter_;
    resolver = resolver_;
    yesNotBefore = resolutionConfig_.yesNotBefore;
    noNotBefore = resolutionConfig_.noNotBefore;
    disputeWindow = resolutionConfig_.disputeWindow;
    disputeBond = resolutionConfig_.disputeBond;
    yesToken = new OutcomeToken(
      string.concat(marketName_, " YES"),
      string.concat(marketSymbol_, "YES"),
      outcomeDecimals_,
      address(this)
    );
    noToken = new OutcomeToken(
      string.concat(marketName_, " NO"),
      string.concat(marketSymbol_, "NO"),
      outcomeDecimals_,
      address(this)
    );
  }

  /// @notice Returns the winning side after resolution.
  /// @return Side that can redeem for collateral.
  function winningSide() external view returns (MarketTypes.Side) {
    _requireStatus(Status.Resolved);
    return _winningSide;
  }

  /// @notice Converts collateral raw units into outcome token raw units.
  /// @param collateralAmount Collateral amount to convert.
  /// @return Outcome token amount represented by `collateralAmount`.
  function outcomeAmountForCollateral(uint256 collateralAmount) public view returns (uint256) {
    return _scaleAmount(collateralAmount, collateralDecimals, outcomeDecimals);
  }

  /// @notice Converts outcome token raw units into collateral raw units.
  /// @param outcomeAmount Outcome token amount to convert.
  /// @return Collateral amount represented by `outcomeAmount`.
  function collateralAmountForOutcome(uint256 outcomeAmount) public view returns (uint256) {
    return _scaleAmount(outcomeAmount, outcomeDecimals, collateralDecimals);
  }

  /// @notice Returns the outcome-token capacity represented by current collateral escrow.
  /// @return Outcome-token capacity backed by the market's collateral balance.
  function collateralOutcomeCapacity() public view returns (uint256) {
    return outcomeAmountForCollateral(_marketCollateralBalance());
  }

  /// @notice Collateral backing outcome redemption. A single seam so the
  /// dispute-bond escrow (ADR 0013, next PR) can be excluded from every
  /// solvency read in one place.
  /// @return Collateral balance available to the market's own accounting.
  function _marketCollateralBalance() private view returns (uint256) {
    return collateralToken.balanceOf(address(this));
  }

  /// @notice Mints equal YES and NO tokens by depositing collateral.
  /// @param to Recipient of both outcome tokens.
  /// @param collateralAmount Collateral amount to deposit.
  /// @return outcomeAmount YES and NO amount minted.
  function mintCompleteSets(
    address to,
    uint256 collateralAmount
  ) external nonReentrant returns (uint256 outcomeAmount) {
    // Open until terminal: trading and retained-claim flows continue
    // through ResolutionPending and Disputed (protocol ADR 0013).
    _requireNotTerminal();
    _requireRecipient(to);
    outcomeAmount = _requireConvertedAmount(
      collateralAmount,
      outcomeAmountForCollateral(collateralAmount)
    );

    _transferCollateralIn(msg.sender, collateralAmount);
    yesToken.mint(to, outcomeAmount);
    noToken.mint(to, outcomeAmount);

    emit CompleteSetsMinted(msg.sender, to, collateralAmount, outcomeAmount);
  }

  /// @notice Burns equal YES and NO tokens before resolution and returns collateral.
  /// @param outcomeAmount YES and NO amount to burn.
  /// @return collateralAmount Collateral returned to the caller.
  function mergeCompleteSets(
    uint256 outcomeAmount
  ) external nonReentrant returns (uint256 collateralAmount) {
    // Open until terminal: trading and retained-claim flows continue
    // through ResolutionPending and Disputed (protocol ADR 0013).
    _requireNotTerminal();
    collateralAmount = _requireConvertedAmount(
      outcomeAmount,
      collateralAmountForOutcome(outcomeAmount)
    );

    yesToken.burnFrom(msg.sender, outcomeAmount);
    noToken.burnFrom(msg.sender, outcomeAmount);
    _requireTradingSolvent(
      _marketCollateralBalance() - collateralAmount,
      yesToken.totalSupply(),
      noToken.totalSupply()
    );
    collateralToken.safeTransfer(msg.sender, collateralAmount);

    emit CompleteSetsMerged(msg.sender, collateralAmount, outcomeAmount);
  }

  /// @notice Funds market-level retained claim capacity from matched graduation collateral.
  /// @param collateralAmount Collateral amount to deposit.
  /// @return outcomeCapacity Outcome-token capacity represented by the deposit.
  function fundRetainedCollateral(
    uint256 collateralAmount
  ) external onlyRetainedMinter nonReentrant returns (uint256 outcomeCapacity) {
    // Open until terminal: trading and retained-claim flows continue
    // through ResolutionPending and Disputed (protocol ADR 0013).
    _requireNotTerminal();
    outcomeCapacity = _requireConvertedAmount(
      collateralAmount,
      outcomeAmountForCollateral(collateralAmount)
    );

    _transferCollateralIn(msg.sender, collateralAmount);

    emit RetainedCollateralFunded(msg.sender, collateralAmount, outcomeCapacity);
  }

  /// @notice Mints one side owed by a finalized retained pregrad claim.
  /// @param to Recipient of retained outcome tokens.
  /// @param side YES or NO side to mint.
  /// @param outcomeAmount Outcome token amount owed to the claimant.
  function mintRetainedSide(
    address to,
    MarketTypes.Side side,
    uint256 outcomeAmount
  ) external onlyRetainedMinter {
    // Open until terminal: trading and retained-claim flows continue
    // through ResolutionPending and Disputed (protocol ADR 0013).
    _requireNotTerminal();
    _requireRecipient(to);
    _requireAmount(outcomeAmount);

    _tokenForSide(side).mint(to, outcomeAmount);
    _requireTradingSolvent(
      _marketCollateralBalance(),
      yesToken.totalSupply(),
      noToken.totalSupply()
    );

    emit RetainedSideMinted(to, side, outcomeAmount);
  }

  /// @notice Returns the proposed winning side while a proposal is pending or disputed.
  /// @return Side the resolver proposed.
  function proposedSide() external view returns (MarketTypes.Side) {
    _requireStatus(Status.ResolutionPending);
    return _proposedSide;
  }

  /// @notice Returns the timestamp at which the pending proposal becomes finalizable.
  /// @return Dispute deadline for the pending proposal.
  function disputeDeadline() public view returns (uint64) {
    _requireStatus(Status.ResolutionPending);
    return proposedAt + disputeWindow;
  }

  /// @notice Proposes a resolution, opening the public dispute window.
  /// @param side Proposed winning outcome side.
  function proposeResolution(MarketTypes.Side side) external onlyResolver {
    _requireStatus(Status.Trading);
    _requireSideNotBefore(side);

    _proposedSide = side;
    proposedAt = uint64(block.timestamp);
    status = Status.ResolutionPending;

    emit ResolutionProposed(side, proposedAt + disputeWindow);
  }

  /// @notice Finalizes an undisputed proposal after the window closes. Callable
  /// by anyone: the keeper drives this, permissionlessness is the safety valve.
  function finalizeResolution() external {
    _requireStatus(Status.ResolutionPending);
    uint64 deadline = proposedAt + disputeWindow;
    if (block.timestamp < deadline) {
      revert DisputeWindowStillOpen(deadline);
    }

    _winningSide = _proposedSide;
    status = Status.Resolved;
    _requireResolvedSolvent(_marketCollateralBalance());

    emit MarketResolved(_proposedSide);
  }

  /// @notice Resolves the market to a winning side in one step. Only markets
  /// deployed with a zero dispute window keep this legacy path (local stacks,
  /// existing tooling); windowed markets must use proposeResolution and the
  /// public window (protocol ADR 0013 — dispute settlement ships next).
  /// @param side Winning outcome side.
  function resolve(MarketTypes.Side side) external onlyResolver {
    _requireStatus(Status.Trading);
    if (disputeWindow != 0) {
      revert MarketNotDirectlyResolvable();
    }
    _requireSideNotBefore(side);

    _winningSide = side;
    status = Status.Resolved;
    _requireResolvedSolvent(_marketCollateralBalance());

    emit MarketResolved(side);
  }

  /// @notice Cancels the market so YES and NO redeem at half collateral value.
  /// Never time-gated: the postponement/draw escape hatch from Trading or a
  /// pending proposal.
  function cancel() external onlyResolver {
    _requireNotTerminal();
    status = Status.Cancelled;
    _requireCancelSolvent(_marketCollateralBalance());

    emit MarketCancelled();
  }

  /// @notice Burns winning tokens after resolution and returns collateral.
  /// @param side Outcome side submitted by the caller.
  /// @param outcomeAmount Winning token amount to burn.
  /// @return collateralAmount Collateral returned to the caller.
  function redeem(
    MarketTypes.Side side,
    uint256 outcomeAmount
  ) external nonReentrant returns (uint256 collateralAmount) {
    _requireStatus(Status.Resolved);
    if (side != _winningSide) {
      revert LosingSideCannotRedeem(side, _winningSide);
    }

    collateralAmount = _requireConvertedAmount(
      outcomeAmount,
      collateralAmountForOutcome(outcomeAmount)
    );
    _tokenForSide(side).burnFrom(msg.sender, outcomeAmount);
    _requireResolvedSolvent(_marketCollateralBalance() - collateralAmount);
    collateralToken.safeTransfer(msg.sender, collateralAmount);

    emit Redeemed(msg.sender, side, outcomeAmount, collateralAmount);
  }

  /// @notice Burns tokens after cancellation and returns half-value collateral.
  /// @param yesAmount YES token amount to burn.
  /// @param noAmount NO token amount to burn.
  /// @return collateralAmount Collateral returned to the caller.
  function redeemCancelled(
    uint256 yesAmount,
    uint256 noAmount
  ) external nonReentrant returns (uint256 collateralAmount) {
    _requireStatus(Status.Cancelled);
    if (yesAmount == 0 && noAmount == 0) {
      revert InvalidAmount();
    }

    uint256 grossCollateralAmount =
      collateralAmountForOutcome(yesAmount) + collateralAmountForOutcome(noAmount);
    collateralAmount = grossCollateralAmount / 2;
    _requireAmount(collateralAmount);

    if (yesAmount != 0) {
      yesToken.burnFrom(msg.sender, yesAmount);
    }
    if (noAmount != 0) {
      noToken.burnFrom(msg.sender, noAmount);
    }
    _requireCancelSolvent(_marketCollateralBalance() - collateralAmount);
    collateralToken.safeTransfer(msg.sender, collateralAmount);

    emit CancelledRedeemed(msg.sender, yesAmount, noAmount, collateralAmount);
  }

  /// @notice Restricts a function to the retained-claim minter.
  modifier onlyRetainedMinter() {
    if (msg.sender != retainedMinter) {
      revert UnauthorizedRetainedMinter(msg.sender);
    }
    _;
  }

  /// @notice Restricts a function to the resolver.
  modifier onlyResolver() {
    if (msg.sender != resolver) {
      revert UnauthorizedResolver(msg.sender);
    }
    _;
  }

  /// @notice Returns the outcome token for a binary side.
  /// @param side YES or NO side.
  /// @return Outcome token for `side`.
  function _tokenForSide(MarketTypes.Side side) private view returns (OutcomeToken) {
    return side == MarketTypes.Side.Yes ? yesToken : noToken;
  }

  /// @notice Transfers collateral into the market and rejects fee-on-transfer behavior.
  /// @param from Account sending collateral.
  /// @param collateralAmount Exact collateral amount expected.
  function _transferCollateralIn(address from, uint256 collateralAmount) private {
    uint256 balanceBefore = collateralToken.balanceOf(address(this));
    collateralToken.safeTransferFrom(from, address(this), collateralAmount);
    uint256 balanceAfter = collateralToken.balanceOf(address(this));
    uint256 received = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;

    if (received != collateralAmount) {
      revert InvalidCollateralTransfer(collateralAmount, received);
    }
  }

  /// @notice Converts an amount between different ERC20 decimal precisions.
  /// @param amount Raw amount to convert.
  /// @param fromDecimals Decimal precision of `amount`.
  /// @param toDecimals Desired decimal precision.
  /// @return converted Converted raw amount.
  function _scaleAmount(
    uint256 amount,
    uint8 fromDecimals,
    uint8 toDecimals
  ) private pure returns (uint256 converted) {
    if (amount == 0 || fromDecimals == toDecimals) {
      return amount;
    }
    if (fromDecimals < toDecimals) {
      return amount * (10 ** uint256(toDecimals - fromDecimals));
    }

    uint256 factor = 10 ** uint256(fromDecimals - toDecimals);
    if (amount % factor != 0) {
      revert AmountHasDust(amount, factor);
    }
    return amount / factor;
  }

  /// @notice Requires that a conversion input and output are both nonzero.
  /// @param inputAmount Raw amount before conversion.
  /// @param convertedAmount Raw amount after conversion.
  /// @return Converted amount when both values are nonzero.
  function _requireConvertedAmount(
    uint256 inputAmount,
    uint256 convertedAmount
  ) private pure returns (uint256) {
    _requireAmount(inputAmount);
    _requireAmount(convertedAmount);
    return convertedAmount;
  }

  /// @notice Requires a nonzero amount.
  /// @param amount Amount to check.
  function _requireAmount(uint256 amount) private pure {
    if (amount == 0) {
      revert InvalidAmount();
    }
  }

  /// @notice Requires a nonzero recipient.
  /// @param to Recipient address.
  function _requireRecipient(address to) private pure {
    if (to == address(0)) {
      revert InvalidRecipient();
    }
  }

  /// @notice Requires the market to be in the expected lifecycle status.
  /// @param expected Required lifecycle status.
  function _requireStatus(Status expected) private view {
    if (status != expected) {
      revert InvalidStatus(status, expected);
    }
  }

  /// @notice Requires a non-terminal status (Trading, ResolutionPending, or
  /// Disputed) — the states in which trading and retained flows stay open.
  function _requireNotTerminal() private view {
    if (status == Status.Resolved || status == Status.Cancelled) {
      revert InvalidStatusForAction(status);
    }
  }

  /// @notice Enforces the per-side earliest-resolution gate. YES may resolve
  /// from yesNotBefore; NO is only certain at the later resolutionTime deadline
  /// (noNotBefore). cancel() stays ungated.
  /// @param side Side being proposed or resolved.
  function _requireSideNotBefore(MarketTypes.Side side) private view {
    uint64 notBefore = side == MarketTypes.Side.Yes ? yesNotBefore : noNotBefore;
    if (block.timestamp < notBefore) {
      revert TooEarlyToResolve(notBefore);
    }
  }

  /// @notice Requires unresolved collateral capacity to cover the larger side supply.
  /// @param collateralBalance Collateral balance to evaluate.
  /// @param yesSupply Current YES supply.
  /// @param noSupply Current NO supply.
  function _requireTradingSolvent(
    uint256 collateralBalance,
    uint256 yesSupply,
    uint256 noSupply
  ) private view {
    uint256 availableOutcomeCapacity = outcomeAmountForCollateral(collateralBalance);
    uint256 requiredOutcomeCapacity = yesSupply > noSupply ? yesSupply : noSupply;
    if (availableOutcomeCapacity < requiredOutcomeCapacity) {
      revert InsolventOutcomeBacking(availableOutcomeCapacity, requiredOutcomeCapacity);
    }
  }

  /// @notice Requires resolved collateral capacity to cover the winning supply.
  /// @param collateralBalance Collateral balance to evaluate.
  function _requireResolvedSolvent(uint256 collateralBalance) private view {
    uint256 availableOutcomeCapacity = outcomeAmountForCollateral(collateralBalance);
    uint256 winningSupply = _tokenForSide(_winningSide).totalSupply();
    if (availableOutcomeCapacity < winningSupply) {
      revert InsolventOutcomeBacking(availableOutcomeCapacity, winningSupply);
    }
  }

  /// @notice Requires collateral to cover remaining draw redemptions after cancellation.
  /// @param collateralBalance Collateral balance to evaluate.
  function _requireCancelSolvent(uint256 collateralBalance) private view {
    uint256 requiredCollateral =
      (collateralAmountForOutcome(yesToken.totalSupply()) +
        collateralAmountForOutcome(noToken.totalSupply())) / 2;
    if (collateralBalance < requiredCollateral) {
      revert InsolventCancelBacking(collateralBalance, requiredCollateral);
    }
  }
}
