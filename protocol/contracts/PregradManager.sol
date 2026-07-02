// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPostgradAdapter} from "./postgrad/IPostgradAdapter.sol";
import {LmsrMath} from "./libraries/LmsrMath.sol";
import {MarketTypes} from "./types/MarketTypes.sol";

/// @title PregradManager
/// @author Pop Charts
/// @notice Singleton manager for all Pop Charts pre-graduation markets.
contract PregradManager is Ownable, ReentrancyGuard {
  using SafeERC20 for IERC20;

  /// @notice Challenge period used after an optimistic clearing root is submitted.
  uint64 public constant CLEARING_CHALLENGE_PERIOD = 1 days;
  /// @notice Lowest opening YES probability allowed for public market creation.
  uint256 public constant MIN_PUBLIC_OPENING_PROBABILITY_WAD = 2e16;
  /// @notice Highest opening YES probability allowed for public market creation.
  uint256 public constant MAX_PUBLIC_OPENING_PROBABILITY_WAD = 98e16;
  /// @notice Lowest virtual LMSR `b` allowed for public market creation.
  uint256 public constant MIN_PUBLIC_LIQUIDITY_PARAMETER = 500 * 1e18;
  /// @notice Highest virtual LMSR `b` allowed for public market creation.
  uint256 public constant MAX_PUBLIC_LIQUIDITY_PARAMETER = 10_000 * 1e18;
  /// @notice Native USDC fee paid by public creators when a market is created.
  uint256 public constant MARKET_CREATION_FEE = 1e18;
  /// @notice Maximum bytes allowed for the self-contained metadata URI emitted at creation.
  uint256 public constant MAX_METADATA_URI_BYTES = 8192;
  /// @notice Domain hash for the locked graduation snapshot committed by clearing roots.
  bytes32 public constant GRADUATION_SNAPSHOT_TYPEHASH = keccak256(
    "GraduationSnapshot(uint256 chainId,address manager,uint256 marketId,uint256 receiptCount,uint256 totalEscrowed,int256 path,uint256 yesShares,uint256 noShares,uint64 graduationStartedAt)"
  );
  /// @notice Domain hash for per-receipt clearing claim Merkle leaves.
  bytes32 public constant RECEIPT_CLAIM_TYPEHASH = keccak256(
    "ReceiptClaim(uint256 marketId,uint256 receiptId,address owner,uint8 side,uint256 retainedShares,uint256 retainedCost,uint256 refund)"
  );

  /// @notice Reverts when a market is created with the zero collateral address.
  error InvalidCollateral();
  /// @notice Reverts when a market is created without a metadata hash.
  error InvalidMetadataHash();
  /// @notice Reverts when a market is created without a self-contained metadata URI.
  error InvalidMetadataURI();
  /// @notice Reverts when a market metadata URI is too large for the creation event.
  /// @param length Byte length supplied by the creator.
  /// @param maximum Maximum supported byte length.
  error MetadataURITooLong(uint256 length, uint256 maximum);
  /// @notice Reverts when the graduation deadline is not in the future.
  error InvalidGraduationDeadline();
  /// @notice Reverts when the resolution deadline is not after the graduation deadline.
  error InvalidResolutionTime();
  /// @notice Reverts when a market is created without a graduation threshold.
  error InvalidGraduationThreshold();
  /// @notice Reverts when a non-trusted creator uses an opening probability outside the public envelope.
  /// @param openingProbabilityWad Opening YES probability supplied by the creator.
  error PublicOpeningProbabilityOutOfBounds(uint256 openingProbabilityWad);
  /// @notice Reverts when a non-trusted creator uses a `b` value outside the public envelope.
  /// @param liquidityParameter Virtual LMSR smoothness parameter supplied by the creator.
  error PublicLiquidityParameterOutOfBounds(uint256 liquidityParameter);
  /// @notice Reverts when a non-trusted creator decouples graduation threshold from `b`.
  /// @param graduationThreshold Graduation threshold supplied by the creator.
  /// @param expectedGraduationThreshold Required threshold for public market creation.
  error PublicGraduationThresholdMismatch(
    uint256 graduationThreshold,
    uint256 expectedGraduationThreshold
  );
  /// @notice Reverts when a non-trusted creator tries to bypass AI-assisted resolution.
  /// @param account Account attempting to create the market.
  error UnauthorizedAiResolutionBypass(address account);
  /// @notice Reverts when new market creation is paused by the owner.
  error MarketCreationPaused();
  /// @notice Reverts when owner configuration targets the zero account.
  error InvalidTrustedCreator();
  /// @notice Reverts when owner fee withdrawal targets the zero account.
  error InvalidCreationFeeRecipient();
  /// @notice Reverts when a market creation transaction sends the wrong native fee.
  /// @param expected Native fee required for the creator.
  /// @param received Native value sent with the transaction.
  error InvalidMarketCreationFee(uint256 expected, uint256 received);
  /// @notice Reverts when owner fee withdrawal exceeds collected fees.
  /// @param available Collected fees available for withdrawal.
  /// @param requested Fee amount requested by the owner.
  error CreationFeeWithdrawalExceedsBalance(uint256 available, uint256 requested);
  /// @notice Reverts when native fee withdrawal fails.
  /// @param recipient Account that should have received the fees.
  /// @param amount Fee amount attempted.
  error CreationFeeWithdrawalFailed(address recipient, uint256 amount);
  /// @notice Reverts when a receipt is placed or quoted with zero shares.
  error InvalidShares();
  /// @notice Reverts when the current receipt quote is above the buyer's maximum accepted cost.
  /// @param cost Current quoted receipt cost.
  /// @param maxCost Maximum cost accepted by the buyer.
  error CostExceedsLimit(uint256 cost, uint256 maxCost);
  /// @notice Reverts when an ERC20 transfer delivers less or more collateral than expected.
  /// @param expected Exact collateral amount that should have reached escrow.
  /// @param received Actual collateral amount observed by balance delta.
  error InvalidCollateralTransfer(uint256 expected, uint256 received);
  /// @notice Reverts when a market-scoped operation references an unknown market.
  /// @param marketId Market ID that does not exist.
  error MarketDoesNotExist(uint256 marketId);
  /// @notice Reverts when a receipt-scoped operation references an unknown receipt.
  /// @param receiptId Receipt ID that does not exist.
  error ReceiptDoesNotExist(uint256 receiptId);
  /// @notice Reverts when a market operation is attempted in the wrong lifecycle status.
  /// @param marketId Market whose status failed the guard.
  /// @param actual Current market status.
  /// @param expected Required market status.
  error InvalidMarketStatus(
    uint256 marketId,
    MarketTypes.MarketStatus actual,
    MarketTypes.MarketStatus expected
  );
  /// @notice Reverts when receipt placement or quoting is attempted after the graduation deadline.
  /// @param marketId Market whose graduation deadline has passed.
  /// @param graduationDeadline Market graduation deadline.
  error MarketPastGraduationDeadline(uint256 marketId, uint64 graduationDeadline);
  /// @notice Reverts when a market is expired before its graduation deadline.
  /// @param marketId Market whose graduation deadline has not passed.
  /// @param graduationDeadline Market graduation deadline.
  error MarketBeforeGraduationDeadline(uint256 marketId, uint64 graduationDeadline);
  /// @notice Reverts when the per-market receipt sequence cannot fit in uint64.
  /// @param receiptCount Receipt count that would overflow the stored sequence type.
  error ReceiptCountOverflow(uint256 receiptCount);
  /// @notice Reverts when an account is not allowed to manage graduation.
  /// @param account Unauthorized account.
  error UnauthorizedGraduationManager(address account);
  /// @notice Reverts when an account is not allowed to review markets.
  /// @param account Unauthorized account.
  error UnauthorizedReviewManager(address account);
  /// @notice Reverts when a clearing root is zero.
  error InvalidClearingRoot();
  /// @notice Reverts when a clearing root already exists for a market.
  /// @param marketId Market that already has a clearing root.
  error ClearingRootAlreadySubmitted(uint256 marketId);
  /// @notice Reverts when a clearing root's matched cap is below the market threshold.
  /// @param matchedMarketCap Matched market cap submitted by the offchain clearing service.
  /// @param graduationThreshold Minimum matched market cap required for the market.
  error MatchedMarketCapBelowThreshold(uint256 matchedMarketCap, uint256 graduationThreshold);
  /// @notice Reverts when clearing totals do not preserve escrow accounting.
  /// @param retainedCostTotal Sum of retained cost submitted by the offchain clearing service.
  /// @param refundTotal Sum of refunds submitted by the offchain clearing service.
  /// @param totalEscrowed Locked market escrow total.
  error InvalidClearingTotals(
    uint256 retainedCostTotal,
    uint256 refundTotal,
    uint256 totalEscrowed
  );
  /// @notice Reverts when matched cap, retained cost, and complete sets disagree.
  /// @param matchedMarketCap Path-compatible filled market cap.
  /// @param retainedCostTotal Sum of retained cost across claim leaves.
  /// @param completeSetCount Complete sets represented by retained exposure.
  error InvalidCompleteSetCount(
    uint256 matchedMarketCap,
    uint256 retainedCostTotal,
    uint256 completeSetCount
  );
  /// @notice Reverts when a market has no clearing root to finalize or claim against.
  /// @param marketId Market missing a clearing root.
  error ClearingRootMissing(uint256 marketId);
  /// @notice Reverts when finalization is attempted before the challenge window closes.
  /// @param marketId Market whose clearing root is still challengeable.
  /// @param challengeDeadline Timestamp when finalization becomes available.
  error ClearingChallengeActive(uint256 marketId, uint64 challengeDeadline);
  /// @notice Reverts when finalization receives the zero postgrad adapter address.
  error InvalidPostgradAdapter();
  /// @notice Reverts when a receipt has already been settled.
  /// @param receiptId Receipt that is no longer active.
  error ReceiptAlreadyClaimed(uint256 receiptId);
  /// @notice Reverts when a receipt claim does not match the stored receipt.
  /// @param receiptId Receipt whose claim payload is invalid.
  error InvalidReceiptClaim(uint256 receiptId);
  /// @notice Reverts when a receipt claim is not included in the clearing root.
  /// @param receiptId Receipt whose Merkle proof failed verification.
  error InvalidClaimProof(uint256 receiptId);

  /// @notice Emitted when a new under-review market is created.
  /// @param marketId Canonical pregrad market ID.
  /// @param creator Account that created the market.
  /// @param metadataHash Hash of market metadata and resolution rules.
  /// @param metadataURI URI where indexers can retrieve the canonical metadata payload.
  /// @param collateral Collateral token accepted by the market.
  /// @param openingProbabilityWad Opening YES probability, scaled by 1e18.
  /// @param liquidityParameter Virtual LMSR smoothness parameter.
  /// @param graduationThreshold Minimum matched market cap required to graduate.
  /// @param graduationDeadline Timestamp by which the market must graduate or become refundable.
  /// @param resolutionTime Timestamp by which the postgrad market should resolve.
  /// @param bypassAiResolution True when a trusted creator opted out of AI-assisted resolution.
  event MarketCreated(
    uint256 indexed marketId,
    address indexed creator,
    bytes32 indexed metadataHash,
    string metadataURI,
    address collateral,
    uint256 openingProbabilityWad,
    uint256 liquidityParameter,
    uint256 graduationThreshold,
    uint64 graduationDeadline,
    uint64 resolutionTime,
    bool bypassAiResolution
  );

  /// @notice Emitted when review approves a market for receipt placement.
  /// @param marketId Market that entered Active status.
  /// @param reviewer Account that approved the market.
  event MarketReviewApproved(uint256 indexed marketId, address indexed reviewer);

  /// @notice Emitted when review rejects a market before receipt placement opens.
  /// @param marketId Market that entered Rejected status.
  /// @param reviewer Account that rejected the market.
  event MarketReviewRejected(uint256 indexed marketId, address indexed reviewer);

  /// @notice Emitted when the owner grants or revokes trusted creator privileges.
  /// @param account Account whose trusted creator status changed.
  /// @param trusted True when the account may bypass public market creation guardrails.
  event TrustedCreatorUpdated(address indexed account, bool trusted);

  /// @notice Emitted when the owner pauses or resumes new market creation.
  /// @param paused True when new market creation is paused.
  event MarketCreationPausedUpdated(bool paused);

  /// @notice Emitted when a public creator pays the market creation fee.
  /// @param marketId Market whose creation paid the fee.
  /// @param creator Account that paid the fee.
  /// @param amount Exact native amount collected as the fee.
  event MarketCreationFeePaid(uint256 indexed marketId, address indexed creator, uint256 amount);

  /// @notice Emitted when the owner withdraws collected market creation fees.
  /// @param recipient Account receiving the fees.
  /// @param amount Fee amount withdrawn.
  event CreationFeesWithdrawn(address indexed recipient, uint256 amount);

  /// @notice Emitted when a locked pre-graduation receipt is placed.
  /// @param receiptId Canonical receipt ID.
  /// @param marketId Market that owns the receipt.
  /// @param owner Account that owns the receipt.
  /// @param side YES or NO side purchased by the receipt.
  /// @param shares Provisional share quantity swept by the receipt.
  /// @param cost Collateral transferred into escrow for the receipt.
  /// @param rLow Lower bound of the LMSR path interval traversed by the receipt.
  /// @param rHigh Upper bound of the LMSR path interval traversed by the receipt.
  /// @param sequence Per-market receipt sequence.
  event ReceiptPlaced(
    uint256 indexed receiptId,
    uint256 indexed marketId,
    address indexed owner,
    MarketTypes.Side side,
    uint256 shares,
    uint256 cost,
    int256 rLow,
    int256 rHigh,
    uint64 sequence
  );

  /// @notice Emitted when the manager locks a market's receipt book for offchain clearing.
  /// @param marketId Market entering the Graduating lifecycle state.
  /// @param manager Account that started graduation.
  /// @param receiptCount Locked receipt count.
  /// @param totalEscrowed Locked escrow total.
  /// @param path Locked LMSR path coordinate.
  /// @param yesShares Locked provisional YES shares.
  /// @param noShares Locked provisional NO shares.
  /// @param graduationStartedAt Timestamp when graduation started.
  /// @param snapshotHash Hash of the locked market state used by the offchain clearing service.
  event GraduationStarted(
    uint256 indexed marketId,
    address indexed manager,
    uint256 receiptCount,
    uint256 totalEscrowed,
    int256 path,
    uint256 yesShares,
    uint256 noShares,
    uint64 graduationStartedAt,
    bytes32 snapshotHash
  );

  /// @notice Emitted when the manager submits an optimistic offchain clearing commitment.
  /// @param marketId Market whose receipt book was cleared offchain.
  /// @param submitter Account that submitted the clearing root.
  /// @param merkleRoot Merkle root of per-receipt claim outcomes.
  /// @param snapshotHash Hash of the locked market state cleared by the root.
  /// @param matchedMarketCap Path-compatible filled market cap.
  /// @param retainedCostTotal Sum of retained cost across all claim leaves.
  /// @param refundTotal Sum of refunds across all claim leaves.
  /// @param completeSetCount Complete sets represented by retained matched exposure.
  /// @param submittedAt Timestamp when the root was submitted.
  /// @param challengeDeadline Timestamp after which the root may be finalized.
  event ClearingRootSubmitted(
    uint256 indexed marketId,
    address indexed submitter,
    bytes32 indexed merkleRoot,
    bytes32 snapshotHash,
    uint256 matchedMarketCap,
    uint256 retainedCostTotal,
    uint256 refundTotal,
    uint256 completeSetCount,
    uint64 submittedAt,
    uint64 challengeDeadline
  );

  /// @notice Emitted when an ungraduated market passes its deadline and enters refund status.
  /// @param marketId Market that became refundable.
  /// @param totalEscrowed Escrow available for future refund claims.
  event MarketRefundsAvailable(uint256 indexed marketId, uint256 totalEscrowed);

  /// @notice Emitted when an accepted clearing root becomes the final graduation settlement.
  /// @param marketId Market whose clearing root was finalized.
  /// @param postgradAdapter Adapter that prepared the postgrad market.
  /// @param postgradMarket Complete-set market prepared for retained claims.
  /// @param completeSetCount Number of complete YES/NO sets backed by retained collateral.
  /// @param retainedCostTotal Collateral retained for postgrad complete sets.
  /// @param refundTotal Collateral left in the manager for receipt refunds.
  event GraduationFinalized(
    uint256 indexed marketId,
    address indexed postgradAdapter,
    address indexed postgradMarket,
    uint256 completeSetCount,
    uint256 retainedCostTotal,
    uint256 refundTotal
  );

  /// @notice Emitted when a finalized receipt claim is settled.
  /// @param receiptId Receipt that was settled.
  /// @param marketId Market that owns the receipt.
  /// @param owner Account receiving retained outcomes and refund.
  /// @param side YES or NO outcome side.
  /// @param retainedShares Outcome token quantity assigned through the postgrad adapter.
  /// @param retainedCost Receipt cost retained for graduated complete sets.
  /// @param refund Collateral refund paid to the receipt owner.
  event GraduatedReceiptClaimed(
    uint256 indexed receiptId,
    uint256 indexed marketId,
    address indexed owner,
    MarketTypes.Side side,
    uint256 retainedShares,
    uint256 retainedCost,
    uint256 refund
  );

  /// @notice Emitted when a receipt from a non-graduated market is refunded.
  /// @param receiptId Receipt that was refunded.
  /// @param marketId Market that owns the receipt.
  /// @param owner Account receiving the refund.
  /// @param refund Full receipt cost returned to the owner.
  event RefundedReceiptClaimed(
    uint256 indexed receiptId,
    uint256 indexed marketId,
    address indexed owner,
    uint256 refund
  );

  uint256 private _nextMarketId = 1;
  uint256 private _nextReceiptId = 1;
  mapping(uint256 marketId => MarketTypes.MarketRecord) private _markets;
  mapping(uint256 receiptId => MarketTypes.Receipt) private _receipts;
  mapping(uint256 marketId => MarketTypes.ClearingRoot) private _clearingRoots;
  mapping(uint256 marketId => address) private _postgradAdapters;
  mapping(address account => bool trusted) private _trustedCreators;
  uint256 private _collectedCreationFees;

  /// @notice Returns true when new market creation is paused.
  bool public marketCreationPaused;

  /// @notice Initializes the contract owner as the first review and graduation manager.
  constructor() Ownable(msg.sender) {}

  /// @notice Restricts a function to the contract's current graduation manager set.
  modifier onlyGraduationManager() {
    _requireGraduationManager(msg.sender);
    _;
  }

  /// @notice Restricts a function to the contract's current review manager set.
  modifier onlyReviewManager() {
    _requireReviewManager(msg.sender);
    _;
  }

  /// @notice Creates a new market in UnderReview status.
  /// @param params Market creation parameters, excluding creator.
  /// @return marketId Canonical pregrad market ID.
  function createMarket(
    MarketTypes.CreateMarketParams calldata params
  ) external payable nonReentrant returns (uint256 marketId) {
    _requireMarketCreationOpen();
    _validateCreateMarketParams(params);

    marketId = _nextMarketId;
    uint256 creationFee = marketCreationFee(msg.sender);
    _collectCreationFee(creationFee);

    ++_nextMarketId;

    MarketTypes.MarketRecord storage market = _markets[marketId];
    market.config = MarketTypes.MarketConfig({
      collateral: params.collateral,
      creator: msg.sender,
      metadataHash: params.metadataHash,
      openingProbabilityWad: params.openingProbabilityWad,
      liquidityParameter: params.liquidityParameter,
      graduationThreshold: params.graduationThreshold,
      graduationDeadline: params.graduationDeadline,
      resolutionTime: params.resolutionTime,
      bypassAiResolution: params.bypassAiResolution
    });
    market.state.status = MarketTypes.MarketStatus.UnderReview;
    market.state.path = LmsrMath.openingPath(
      params.openingProbabilityWad,
      params.liquidityParameter
    );

    emit MarketCreated(
      marketId,
      msg.sender,
      params.metadataHash,
      params.metadataURI,
      params.collateral,
      params.openingProbabilityWad,
      params.liquidityParameter,
      params.graduationThreshold,
      params.graduationDeadline,
      params.resolutionTime,
      params.bypassAiResolution
    );

    if (creationFee != 0) {
      emit MarketCreationFeePaid(marketId, msg.sender, creationFee);
    }
  }

  /// @notice Approves an under-review market so it can accept pre-graduation receipts.
  /// @param marketId Market that passed review.
  function approveMarket(uint256 marketId) external onlyReviewManager {
    _requireMarketExists(marketId);

    MarketTypes.MarketRecord storage market = _markets[marketId];
    _requireUnderReviewMarket(marketId, market);
    _requireBeforeGraduationDeadline(marketId, market.config.graduationDeadline);

    market.state.status = MarketTypes.MarketStatus.Active;

    emit MarketReviewApproved(marketId, msg.sender);
  }

  /// @notice Rejects an under-review market and keeps it closed to receipt placement.
  /// @param marketId Market that failed review.
  function rejectMarket(uint256 marketId) external onlyReviewManager {
    _requireMarketExists(marketId);

    MarketTypes.MarketRecord storage market = _markets[marketId];
    _requireUnderReviewMarket(marketId, market);

    market.state.status = MarketTypes.MarketStatus.Rejected;

    emit MarketReviewRejected(marketId, msg.sender);
  }

  /// @notice Grants or revokes public creation guardrail bypass privileges.
  /// @param account Account whose trusted creator status will change.
  /// @param trusted True to grant trusted creator privileges; false to revoke them.
  function setTrustedCreator(address account, bool trusted) external onlyOwner {
    if (account == address(0)) {
      revert InvalidTrustedCreator();
    }

    _trustedCreators[account] = trusted;
    emit TrustedCreatorUpdated(account, trusted);
  }

  /// @notice Pauses or resumes new market creation.
  /// @param paused True to block `createMarket`; false to resume it.
  function setMarketCreationPaused(bool paused) external onlyOwner {
    marketCreationPaused = paused;
    emit MarketCreationPausedUpdated(paused);
  }

  /// @notice Withdraws collected market creation fees without touching receipt escrow.
  /// @param recipient Account receiving the fees.
  /// @param amount Fee amount to withdraw.
  function withdrawCreationFees(
    address payable recipient,
    uint256 amount
  ) external onlyOwner nonReentrant {
    if (recipient == address(0)) {
      revert InvalidCreationFeeRecipient();
    }

    uint256 available = _collectedCreationFees;
    if (amount > available) {
      revert CreationFeeWithdrawalExceedsBalance(available, amount);
    }

    _collectedCreationFees = available - amount;
    (bool success, ) = recipient.call{value: amount}("");
    if (!success) {
      revert CreationFeeWithdrawalFailed(recipient, amount);
    }

    emit CreationFeesWithdrawn(recipient, amount);
  }

  /// @notice Returns the next market ID that will be assigned.
  /// @return Next market ID.
  function nextMarketId() external view returns (uint256) {
    return _nextMarketId;
  }

  /// @notice Returns the next receipt ID that will be assigned.
  /// @return Next receipt ID.
  function nextReceiptId() external view returns (uint256) {
    return _nextReceiptId;
  }

  /// @notice Returns the total number of markets created.
  /// @return Number of markets created by this manager.
  function marketCount() external view returns (uint256) {
    return _nextMarketId - 1;
  }

  /// @notice Returns the total number of receipts created.
  /// @return Number of receipts created by this manager.
  function totalReceiptCount() external view returns (uint256) {
    return _nextReceiptId - 1;
  }

  /// @notice Returns whether `marketId` exists.
  /// @param marketId Market ID to check.
  /// @return True if the market exists.
  function marketExists(uint256 marketId) public view returns (bool) {
    return marketId != 0 && marketId < _nextMarketId;
  }

  /// @notice Returns whether `receiptId` exists.
  /// @param receiptId Receipt ID to check.
  /// @return True if the receipt exists.
  function receiptExists(uint256 receiptId) public view returns (bool) {
    return receiptId != 0 && receiptId < _nextReceiptId;
  }

  /// @notice Returns immutable market configuration.
  /// @param marketId Market ID to read.
  /// @return Market configuration.
  function getMarketConfig(
    uint256 marketId
  ) external view returns (MarketTypes.MarketConfig memory) {
    _requireMarketExists(marketId);
    return _markets[marketId].config;
  }

  /// @notice Returns mutable market lifecycle and accounting state.
  /// @param marketId Market ID to read.
  /// @return Market lifecycle and accounting state.
  function getMarketState(uint256 marketId) external view returns (MarketTypes.MarketState memory) {
    _requireMarketExists(marketId);
    return _markets[marketId].state;
  }

  /// @notice Returns a stored locked receipt.
  /// @param receiptId Receipt ID to read.
  /// @return Locked receipt record.
  function getReceipt(uint256 receiptId) external view returns (MarketTypes.Receipt memory) {
    _requireReceiptExists(receiptId);
    return _receipts[receiptId];
  }

  /// @notice Returns whether `account` can review markets.
  /// @param account Account to check.
  /// @return True if the account can approve or reject markets.
  function isReviewManager(address account) public view returns (bool) {
    return account == owner();
  }

  /// @notice Returns whether `account` can manage graduation.
  /// @param account Account to check.
  /// @return True if the account can start graduation or submit clearing roots.
  function isGraduationManager(address account) public view returns (bool) {
    return account == owner();
  }

  /// @notice Returns whether `account` may bypass public market creation guardrails.
  /// @param account Account to check.
  /// @return True if the account can create custom markets and opt out of AI-assisted resolution.
  function isTrustedCreator(address account) public view returns (bool) {
    return _trustedCreators[account];
  }

  /// @notice Returns the market creation fee for `creator`.
  /// @param creator Account that would create a market.
  /// @return Native fee amount; zero for trusted creators.
  function marketCreationFee(address creator) public view returns (uint256) {
    return isTrustedCreator(creator) ? 0 : MARKET_CREATION_FEE;
  }

  /// @notice Returns collected native market creation fees not yet withdrawn.
  /// @return Fee amount collected and not yet withdrawn.
  function collectedCreationFees() external view returns (uint256) {
    return _collectedCreationFees;
  }

  /// @notice Returns the optimistic clearing root stored for a market.
  /// @param marketId Market ID to read.
  /// @return Stored clearing root, or a zero-valued record if none was submitted.
  function getClearingRoot(
    uint256 marketId
  ) external view returns (MarketTypes.ClearingRoot memory) {
    _requireMarketExists(marketId);
    return _clearingRoots[marketId];
  }

  /// @notice Returns whether a market already has a submitted clearing root.
  /// @param marketId Market ID to check.
  /// @return True if the market has a nonzero clearing root.
  function hasClearingRoot(uint256 marketId) public view returns (bool) {
    _requireMarketExists(marketId);
    return _clearingRoots[marketId].merkleRoot != bytes32(0);
  }

  /// @notice Returns the postgrad adapter chosen when a market finalized graduation.
  /// @param marketId Market ID to read.
  /// @return Adapter address, or zero if graduation has not finalized.
  function getPostgradAdapter(uint256 marketId) external view returns (address) {
    _requireMarketExists(marketId);
    return _postgradAdapters[marketId];
  }

  /// @notice Computes the current graduation snapshot hash for a market.
  /// @param marketId Market ID to hash.
  /// @return Snapshot hash for the market's current lifecycle/accounting state.
  function graduationSnapshotHash(uint256 marketId) external view returns (bytes32) {
    _requireMarketExists(marketId);
    return _graduationSnapshotHash(marketId, _markets[marketId].state);
  }

  /// @notice Hashes a per-receipt clearing claim for Merkle tree construction.
  /// @param claim Claim payload committed by the clearing root.
  /// @return Merkle leaf hash.
  function hashReceiptClaim(
    MarketTypes.ReceiptClaim calldata claim
  ) external pure returns (bytes32) {
    return _hashReceiptClaim(claim);
  }

  /// @notice Returns the current quote for a prospective receipt.
  /// @param marketId Market receiving the receipt.
  /// @param side YES or NO side to buy.
  /// @param shares Provisional share quantity to buy.
  /// @return Current receipt quote.
  function quoteReceipt(
    uint256 marketId,
    MarketTypes.Side side,
    uint256 shares
  ) external view returns (MarketTypes.ReceiptQuote memory) {
    _requireMarketExists(marketId);
    _validateReceiptShares(shares);

    MarketTypes.MarketRecord storage market = _markets[marketId];
    _requireActiveMarket(marketId, market);
    _requireBeforeGraduationDeadline(marketId, market.config.graduationDeadline);

    return _quoteReceipt(market, side, shares);
  }

  /// @notice Places a locked pre-graduation receipt and escrows its collateral cost.
  /// @param params Receipt placement parameters.
  /// @return receiptId Canonical receipt ID.
  function placeReceipt(
    MarketTypes.PlaceReceiptParams calldata params
  ) external nonReentrant returns (uint256 receiptId) {
    _requireMarketExists(params.marketId);
    _validateReceiptShares(params.shares);

    MarketTypes.MarketRecord storage market = _markets[params.marketId];
    _requireActiveMarket(params.marketId, market);
    _requireBeforeGraduationDeadline(params.marketId, market.config.graduationDeadline);

    MarketTypes.ReceiptQuote memory quote = _quoteReceipt(market, params.side, params.shares);
    if (quote.cost > params.maxCost) {
      revert CostExceedsLimit(quote.cost, params.maxCost);
    }

    receiptId = _nextReceiptId;
    ++_nextReceiptId;

    uint64 sequence = _storeReceipt(receiptId, market, params, quote);

    _transferEscrow(IERC20(market.config.collateral), msg.sender, quote.cost);

    emit ReceiptPlaced(
      receiptId,
      params.marketId,
      msg.sender,
      params.side,
      params.shares,
      quote.cost,
      quote.rLow,
      quote.rHigh,
      sequence
    );
  }

  /// @notice Validates and accounts for the native market creation fee.
  /// @param amount Exact native fee amount required.
  function _collectCreationFee(uint256 amount) private {
    if (msg.value != amount) {
      revert InvalidMarketCreationFee(amount, msg.value);
    }

    _collectedCreationFees += amount;
  }

  /// @notice Locks an active market's receipt book while the offchain service computes clearing.
  /// @param marketId Market entering the Graduating lifecycle state.
  /// @return snapshotHash Hash of the locked market state.
  function startGraduation(
    uint256 marketId
  ) external onlyGraduationManager returns (bytes32 snapshotHash) {
    _requireMarketExists(marketId);

    MarketTypes.MarketRecord storage market = _markets[marketId];
    _requireActiveMarket(marketId, market);
    _requireBeforeGraduationDeadline(marketId, market.config.graduationDeadline);

    market.state.status = MarketTypes.MarketStatus.Graduating;
    market.state.graduationStartedAt = uint64(block.timestamp);
    snapshotHash = _graduationSnapshotHash(marketId, market.state);

    emit GraduationStarted(
      marketId,
      msg.sender,
      market.state.receiptCount,
      market.state.totalEscrowed,
      market.state.path,
      market.state.yesShares,
      market.state.noShares,
      market.state.graduationStartedAt,
      snapshotHash
    );
  }

  /// @notice Stores an optimistic clearing root computed by the offchain clearing service.
  /// @param params Clearing root totals and Merkle root.
  /// @return snapshotHash Hash of the locked market state cleared by the root.
  function submitClearingRoot(
    MarketTypes.SubmitClearingRootParams calldata params
  ) external onlyGraduationManager returns (bytes32 snapshotHash) {
    _requireMarketExists(params.marketId);

    MarketTypes.MarketRecord storage market = _markets[params.marketId];
    _requireGraduatingMarket(params.marketId, market);
    _validateClearingRoot(params, market);

    snapshotHash = _graduationSnapshotHash(params.marketId, market.state);
    uint64 submittedAt = uint64(block.timestamp);
    uint64 challengeDeadline = submittedAt + CLEARING_CHALLENGE_PERIOD;

    _clearingRoots[params.marketId] = MarketTypes.ClearingRoot({
      merkleRoot: params.merkleRoot,
      submitter: msg.sender,
      snapshotHash: snapshotHash,
      submittedAt: submittedAt,
      challengeDeadline: challengeDeadline,
      matchedMarketCap: params.matchedMarketCap,
      retainedCostTotal: params.retainedCostTotal,
      refundTotal: params.refundTotal,
      completeSetCount: params.completeSetCount
    });

    emit ClearingRootSubmitted(
      params.marketId,
      msg.sender,
      params.merkleRoot,
      snapshotHash,
      params.matchedMarketCap,
      params.retainedCostTotal,
      params.refundTotal,
      params.completeSetCount,
      submittedAt,
      challengeDeadline
    );
  }

  /// @notice Finalizes an accepted offchain clearing root after the challenge window.
  /// @param marketId Market whose clearing root is becoming final.
  /// @param postgradAdapter Adapter that will prepare and distribute postgrad outcomes.
  function finalizeGraduation(
    uint256 marketId,
    address postgradAdapter
  ) external onlyGraduationManager nonReentrant {
    _requireMarketExists(marketId);
    if (postgradAdapter == address(0)) {
      revert InvalidPostgradAdapter();
    }

    MarketTypes.MarketRecord storage market = _markets[marketId];
    _requireGraduatingMarket(marketId, market);
    MarketTypes.ClearingRoot storage clearingRoot = _requireClearingRoot(marketId);
    _requireChallengeComplete(marketId, clearingRoot.challengeDeadline);

    IERC20 collateralToken = IERC20(market.config.collateral);
    uint256 balanceBefore = collateralToken.balanceOf(address(this));
    collateralToken.forceApprove(postgradAdapter, clearingRoot.retainedCostTotal);
    address postgradMarket = IPostgradAdapter(postgradAdapter).prepareMarket(
      marketId,
      market.config.collateral,
      market.config.metadataHash,
      clearingRoot.retainedCostTotal,
      clearingRoot.completeSetCount
    );
    collateralToken.forceApprove(postgradAdapter, 0);
    uint256 balanceAfter = collateralToken.balanceOf(address(this));
    uint256 transferred = balanceBefore > balanceAfter ? balanceBefore - balanceAfter : 0;
    if (transferred != clearingRoot.retainedCostTotal) {
      revert InvalidCollateralTransfer(clearingRoot.retainedCostTotal, transferred);
    }

    market.state.status = MarketTypes.MarketStatus.Graduated;
    market.state.totalEscrowed = clearingRoot.refundTotal;
    _postgradAdapters[marketId] = postgradAdapter;

    emit GraduationFinalized(
      marketId,
      postgradAdapter,
      postgradMarket,
      clearingRoot.completeSetCount,
      clearingRoot.retainedCostTotal,
      clearingRoot.refundTotal
    );
  }

  /// @notice Settles a finalized receipt using its offchain clearing Merkle proof.
  /// @param claim Per-receipt clearing outcome committed by the submitted root.
  /// @param proof Merkle proof showing the claim is included in the clearing root.
  function claimGraduatedReceipt(
    MarketTypes.ReceiptClaim calldata claim,
    bytes32[] calldata proof
  ) external nonReentrant {
    _requireMarketExists(claim.marketId);
    _requireReceiptExists(claim.receiptId);

    MarketTypes.MarketRecord storage market = _markets[claim.marketId];
    _requireGraduatedMarket(claim.marketId, market);
    MarketTypes.Receipt storage receipt = _receipts[claim.receiptId];
    _validateReceiptClaim(claim, receipt);
    _verifyReceiptClaim(claim, proof, _requireClearingRoot(claim.marketId));

    receipt.active = false;
    market.state.totalEscrowed -= claim.refund;

    address postgradAdapter = _postgradAdapters[claim.marketId];
    if (claim.retainedShares != 0) {
      IPostgradAdapter(postgradAdapter).distributeOutcome(
        claim.marketId,
        claim.owner,
        claim.side,
        claim.retainedShares
      );
    }
    if (claim.refund != 0) {
      IERC20(market.config.collateral).safeTransfer(claim.owner, claim.refund);
    }

    emit GraduatedReceiptClaimed(
      claim.receiptId,
      claim.marketId,
      claim.owner,
      claim.side,
      claim.retainedShares,
      claim.retainedCost,
      claim.refund
    );
  }

  /// @notice Marks an active market refundable after its graduation deadline passes.
  /// @param marketId Market that did not enter graduation before its deadline.
  function markRefundable(uint256 marketId) external {
    _requireMarketExists(marketId);

    MarketTypes.MarketRecord storage market = _markets[marketId];
    _requireActiveMarket(marketId, market);
    _requireAtOrAfterGraduationDeadline(marketId, market.config.graduationDeadline);

    market.state.status = MarketTypes.MarketStatus.Refunded;

    emit MarketRefundsAvailable(marketId, market.state.totalEscrowed);
  }

  /// @notice Refunds a receipt from a market that missed graduation.
  /// @param receiptId Receipt whose full escrowed cost should be returned.
  function claimRefundedReceipt(uint256 receiptId) external nonReentrant {
    _requireReceiptExists(receiptId);

    MarketTypes.Receipt storage receipt = _receipts[receiptId];
    MarketTypes.MarketRecord storage market = _markets[receipt.marketId];
    _requireRefundedMarket(receipt.marketId, market);
    _requireActiveReceipt(receiptId, receipt);

    receipt.active = false;
    market.state.totalEscrowed -= receipt.cost;

    IERC20(market.config.collateral).safeTransfer(receipt.owner, receipt.cost);

    emit RefundedReceiptClaimed(receiptId, receipt.marketId, receipt.owner, receipt.cost);
  }

  /// @notice Stores receipt data and updates per-market accounting before collateral transfer.
  /// @param receiptId Canonical receipt ID.
  /// @param market Market storage record being updated.
  /// @param params Receipt placement parameters.
  /// @param quote Current quote being committed.
  /// @return sequence Per-market receipt sequence assigned to the receipt.
  function _storeReceipt(
    uint256 receiptId,
    MarketTypes.MarketRecord storage market,
    MarketTypes.PlaceReceiptParams calldata params,
    MarketTypes.ReceiptQuote memory quote
  ) private returns (uint64 sequence) {
    sequence = _nextReceiptSequence(market.state.receiptCount);
    market.state.receiptCount = sequence;
    market.state.totalEscrowed += quote.cost;
    market.state.path = params.side == MarketTypes.Side.Yes ? quote.rHigh : quote.rLow;
    if (params.side == MarketTypes.Side.Yes) {
      market.state.yesShares += params.shares;
    } else {
      market.state.noShares += params.shares;
    }

    _receipts[receiptId] = MarketTypes.Receipt({
      marketId: params.marketId,
      owner: msg.sender,
      side: params.side,
      shares: params.shares,
      cost: quote.cost,
      rLow: quote.rLow,
      rHigh: quote.rHigh,
      sequence: sequence,
      active: true
    });
  }

  /// @notice Validates immutable market creation inputs.
  /// @param params Market creation parameters.
  function _validateCreateMarketParams(
    MarketTypes.CreateMarketParams calldata params
  ) private view {
    bool trustedCreator = isTrustedCreator(msg.sender);

    if (params.collateral == address(0)) {
      revert InvalidCollateral();
    }
    if (params.metadataHash == bytes32(0)) {
      revert InvalidMetadataHash();
    }
    uint256 metadataURILength = bytes(params.metadataURI).length;
    if (metadataURILength == 0 || !_isDataURI(params.metadataURI)) {
      revert InvalidMetadataURI();
    }
    if (metadataURILength > MAX_METADATA_URI_BYTES) {
      revert MetadataURITooLong(metadataURILength, MAX_METADATA_URI_BYTES);
    }
    if (params.graduationDeadline <= block.timestamp) {
      revert InvalidGraduationDeadline();
    }
    if (params.resolutionTime <= params.graduationDeadline) {
      revert InvalidResolutionTime();
    }
    if (params.graduationThreshold == 0) {
      revert InvalidGraduationThreshold();
    }

    LmsrMath.validateOpeningProbability(params.openingProbabilityWad);
    LmsrMath.validateLiquidityParameter(params.liquidityParameter);

    if (params.bypassAiResolution && !trustedCreator) {
      revert UnauthorizedAiResolutionBypass(msg.sender);
    }

    if (!trustedCreator) {
      _validatePublicCreateMarketParams(params);
    }
  }

  /// @notice Enforces the public market creation envelope for non-trusted creators.
  /// @param params Market creation parameters.
  function _validatePublicCreateMarketParams(
    MarketTypes.CreateMarketParams calldata params
  ) private pure {
    if (
      params.openingProbabilityWad < MIN_PUBLIC_OPENING_PROBABILITY_WAD ||
      params.openingProbabilityWad > MAX_PUBLIC_OPENING_PROBABILITY_WAD
    ) {
      revert PublicOpeningProbabilityOutOfBounds(params.openingProbabilityWad);
    }

    if (
      params.liquidityParameter < MIN_PUBLIC_LIQUIDITY_PARAMETER ||
      params.liquidityParameter > MAX_PUBLIC_LIQUIDITY_PARAMETER
    ) {
      revert PublicLiquidityParameterOutOfBounds(params.liquidityParameter);
    }

    uint256 expectedGraduationThreshold = params.liquidityParameter / 2;
    if (params.graduationThreshold != expectedGraduationThreshold) {
      revert PublicGraduationThresholdMismatch(
        params.graduationThreshold,
        expectedGraduationThreshold
      );
    }
  }

  /// @notice Requires new market creation to be open.
  function _requireMarketCreationOpen() private view {
    if (marketCreationPaused) {
      revert MarketCreationPaused();
    }
  }

  /// @notice Transfers receipt collateral and rejects tokens whose received amount differs from cost.
  /// @param collateral ERC20 collateral token.
  /// @param from Account paying the receipt cost.
  /// @param cost Exact collateral amount expected in escrow.
  function _transferEscrow(IERC20 collateral, address from, uint256 cost) private {
    _transferExactCollateral(collateral, from, address(this), cost);
  }

  /// @notice Transfers collateral and rejects tokens whose received amount differs from expected.
  /// @param collateral ERC20 collateral token.
  /// @param from Account paying collateral.
  /// @param to Account receiving collateral.
  /// @param amount Exact collateral amount expected at the recipient.
  function _transferExactCollateral(
    IERC20 collateral,
    address from,
    address to,
    uint256 amount
  ) private {
    uint256 balanceBefore = collateral.balanceOf(to);
    collateral.safeTransferFrom(from, to, amount);
    uint256 balanceAfter = collateral.balanceOf(to);
    uint256 received = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;

    if (received != amount) {
      revert InvalidCollateralTransfer(amount, received);
    }
  }

  /// @notice Quotes a receipt against the market's current path state.
  /// @param market Market storage record being quoted.
  /// @param side YES or NO side to buy.
  /// @param shares Provisional share quantity to buy.
  /// @return Current receipt quote.
  function _quoteReceipt(
    MarketTypes.MarketRecord storage market,
    MarketTypes.Side side,
    uint256 shares
  ) private view returns (MarketTypes.ReceiptQuote memory) {
    return
      LmsrMath.quoteBinaryReceipt(
        market.state.path,
        side,
        shares,
        market.config.liquidityParameter
      );
  }

  /// @notice Validates that a receipt quote or placement has nonzero shares.
  /// @param shares Provisional share quantity to validate.
  function _validateReceiptShares(uint256 shares) private pure {
    if (shares == 0) {
      revert InvalidShares();
    }
  }

  /// @notice Validates an optimistic clearing root against a graduating market.
  /// @param params Clearing root parameters submitted by the offchain clearing service.
  /// @param market Market storage record being cleared.
  function _validateClearingRoot(
    MarketTypes.SubmitClearingRootParams calldata params,
    MarketTypes.MarketRecord storage market
  ) private view {
    if (params.merkleRoot == bytes32(0)) {
      revert InvalidClearingRoot();
    }
    if (_clearingRoots[params.marketId].merkleRoot != bytes32(0)) {
      revert ClearingRootAlreadySubmitted(params.marketId);
    }
    if (params.matchedMarketCap < market.config.graduationThreshold) {
      revert MatchedMarketCapBelowThreshold(
        params.matchedMarketCap,
        market.config.graduationThreshold
      );
    }
    if (params.retainedCostTotal + params.refundTotal != market.state.totalEscrowed) {
      revert InvalidClearingTotals(
        params.retainedCostTotal,
        params.refundTotal,
        market.state.totalEscrowed
      );
    }
    if (
      params.retainedCostTotal != params.matchedMarketCap ||
      params.completeSetCount != params.matchedMarketCap
    ) {
      revert InvalidCompleteSetCount(
        params.matchedMarketCap,
        params.retainedCostTotal,
        params.completeSetCount
      );
    }
  }

  /// @notice Validates a receipt claim against the stored receipt.
  /// @param claim Offchain clearing outcome being claimed.
  /// @param receipt Stored receipt being settled.
  function _validateReceiptClaim(
    MarketTypes.ReceiptClaim calldata claim,
    MarketTypes.Receipt storage receipt
  ) private view {
    _requireActiveReceipt(claim.receiptId, receipt);

    if (
      receipt.marketId != claim.marketId ||
      receipt.owner != claim.owner ||
      receipt.side != claim.side ||
      claim.retainedShares > receipt.shares ||
      claim.retainedCost + claim.refund != receipt.cost
    ) {
      revert InvalidReceiptClaim(claim.receiptId);
    }
  }

  /// @notice Verifies a receipt claim against a stored clearing root.
  /// @param claim Offchain clearing outcome being claimed.
  /// @param proof Merkle proof for the claim leaf.
  /// @param clearingRoot Stored clearing commitment.
  function _verifyReceiptClaim(
    MarketTypes.ReceiptClaim calldata claim,
    bytes32[] calldata proof,
    MarketTypes.ClearingRoot storage clearingRoot
  ) private view {
    if (!MerkleProof.verifyCalldata(proof, clearingRoot.merkleRoot, _hashReceiptClaim(claim))) {
      revert InvalidClaimProof(claim.receiptId);
    }
  }

  /// @notice Requires a market to be in UnderReview status.
  /// @param marketId Market ID being guarded.
  /// @param market Market storage record being guarded.
  function _requireUnderReviewMarket(
    uint256 marketId,
    MarketTypes.MarketRecord storage market
  ) private view {
    if (market.state.status != MarketTypes.MarketStatus.UnderReview) {
      revert InvalidMarketStatus(
        marketId,
        market.state.status,
        MarketTypes.MarketStatus.UnderReview
      );
    }
  }

  /// @notice Requires a market to be in Active status.
  /// @param marketId Market ID being guarded.
  /// @param market Market storage record being guarded.
  function _requireActiveMarket(
    uint256 marketId,
    MarketTypes.MarketRecord storage market
  ) private view {
    if (market.state.status != MarketTypes.MarketStatus.Active) {
      revert InvalidMarketStatus(marketId, market.state.status, MarketTypes.MarketStatus.Active);
    }
  }

  /// @notice Requires a market to be in Graduating status.
  /// @param marketId Market ID being guarded.
  /// @param market Market storage record being guarded.
  function _requireGraduatingMarket(
    uint256 marketId,
    MarketTypes.MarketRecord storage market
  ) private view {
    if (market.state.status != MarketTypes.MarketStatus.Graduating) {
      revert InvalidMarketStatus(
        marketId,
        market.state.status,
        MarketTypes.MarketStatus.Graduating
      );
    }
  }

  /// @notice Requires a market to be in Graduated status.
  /// @param marketId Market ID being guarded.
  /// @param market Market storage record being guarded.
  function _requireGraduatedMarket(
    uint256 marketId,
    MarketTypes.MarketRecord storage market
  ) private view {
    if (market.state.status != MarketTypes.MarketStatus.Graduated) {
      revert InvalidMarketStatus(marketId, market.state.status, MarketTypes.MarketStatus.Graduated);
    }
  }

  /// @notice Requires a market to be in Refunded status.
  /// @param marketId Market ID being guarded.
  /// @param market Market storage record being guarded.
  function _requireRefundedMarket(
    uint256 marketId,
    MarketTypes.MarketRecord storage market
  ) private view {
    if (market.state.status != MarketTypes.MarketStatus.Refunded) {
      revert InvalidMarketStatus(marketId, market.state.status, MarketTypes.MarketStatus.Refunded);
    }
  }

  /// @notice Requires the current block timestamp to be before the market graduation deadline.
  /// @param marketId Market ID being guarded.
  /// @param graduationDeadline Market graduation deadline.
  function _requireBeforeGraduationDeadline(
    uint256 marketId,
    uint64 graduationDeadline
  ) private view {
    if (block.timestamp >= graduationDeadline) {
      revert MarketPastGraduationDeadline(marketId, graduationDeadline);
    }
  }

  /// @notice Requires the current block timestamp to be at or after the graduation deadline.
  /// @param marketId Market ID being guarded.
  /// @param graduationDeadline Market graduation deadline.
  function _requireAtOrAfterGraduationDeadline(
    uint256 marketId,
    uint64 graduationDeadline
  ) private view {
    if (block.timestamp < graduationDeadline) {
      revert MarketBeforeGraduationDeadline(marketId, graduationDeadline);
    }
  }

  /// @notice Requires the clearing root challenge window to have elapsed.
  /// @param marketId Market ID being finalized.
  /// @param challengeDeadline Timestamp when the challenge window closes.
  function _requireChallengeComplete(uint256 marketId, uint64 challengeDeadline) private view {
    if (block.timestamp < challengeDeadline) {
      revert ClearingChallengeActive(marketId, challengeDeadline);
    }
  }

  /// @notice Requires an account to be authorized for graduation management.
  /// @param account Account to check.
  function _requireGraduationManager(address account) private view {
    if (!isGraduationManager(account)) {
      revert UnauthorizedGraduationManager(account);
    }
  }

  /// @notice Requires an account to be authorized for market review.
  /// @param account Account to check.
  function _requireReviewManager(address account) private view {
    if (!isReviewManager(account)) {
      revert UnauthorizedReviewManager(account);
    }
  }

  /// @notice Requires a market ID to exist.
  /// @param marketId Market ID to check.
  function _requireMarketExists(uint256 marketId) private view {
    if (!marketExists(marketId)) {
      revert MarketDoesNotExist(marketId);
    }
  }

  /// @notice Requires a receipt ID to exist.
  /// @param receiptId Receipt ID to check.
  function _requireReceiptExists(uint256 receiptId) private view {
    if (!receiptExists(receiptId)) {
      revert ReceiptDoesNotExist(receiptId);
    }
  }

  /// @notice Requires a clearing root to be present for a market.
  /// @param marketId Market ID to check.
  /// @return clearingRoot Stored clearing root.
  function _requireClearingRoot(
    uint256 marketId
  ) private view returns (MarketTypes.ClearingRoot storage clearingRoot) {
    clearingRoot = _clearingRoots[marketId];
    if (clearingRoot.merkleRoot == bytes32(0)) {
      revert ClearingRootMissing(marketId);
    }
  }

  /// @notice Requires a receipt to still be unsettled.
  /// @param receiptId Receipt ID to check.
  /// @param receipt Receipt storage record being guarded.
  function _requireActiveReceipt(
    uint256 receiptId,
    MarketTypes.Receipt storage receipt
  ) private view {
    if (!receipt.active) {
      revert ReceiptAlreadyClaimed(receiptId);
    }
  }

  /// @notice Computes the next uint64 per-market receipt sequence.
  /// @param receiptCount Current per-market receipt count.
  /// @return Next per-market receipt sequence.
  function _nextReceiptSequence(uint256 receiptCount) private pure returns (uint64) {
    uint256 nextSequence = receiptCount + 1;
    if (nextSequence > type(uint64).max) {
      revert ReceiptCountOverflow(nextSequence);
    }

    return uint64(nextSequence);
  }

  /// @notice Computes the hash for a market's graduation snapshot.
  /// @param marketId Market ID to hash.
  /// @param state Market state to commit.
  /// @return Snapshot hash.
  function _graduationSnapshotHash(
    uint256 marketId,
    MarketTypes.MarketState storage state
  ) private view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          GRADUATION_SNAPSHOT_TYPEHASH,
          block.chainid,
          address(this),
          marketId,
          state.receiptCount,
          state.totalEscrowed,
          state.path,
          state.yesShares,
          state.noShares,
          state.graduationStartedAt
        )
      );
  }

  /// @notice Computes the Merkle leaf hash for a receipt claim.
  /// @param claim Claim payload to hash.
  /// @return Merkle leaf hash.
  function _hashReceiptClaim(
    MarketTypes.ReceiptClaim calldata claim
  ) private pure returns (bytes32) {
    return
      keccak256(
        abi.encode(
          RECEIPT_CLAIM_TYPEHASH,
          claim.marketId,
          claim.receiptId,
          claim.owner,
          uint8(claim.side),
          claim.retainedShares,
          claim.retainedCost,
          claim.refund
        )
      );
  }

  function _isDataURI(string memory value) private pure returns (bool) {
    bytes memory data = bytes(value);

    return
      data.length >= 5 &&
      data[0] == "d" &&
      data[1] == "a" &&
      data[2] == "t" &&
      data[3] == "a" &&
      data[4] == ":";
  }
}
