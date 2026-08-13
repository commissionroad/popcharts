// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPostgradAdapter} from "./postgrad/IPostgradAdapter.sol";
import {LmsrMath} from "./libraries/LmsrMath.sol";
import {ReceiptWithdrawals} from "./libraries/ReceiptWithdrawals.sol";
import {CreationFeeVault} from "./CreationFeeVault.sol";
import {ReceiptBook} from "./ReceiptBook.sol";
import {MarketTypes} from "./types/MarketTypes.sol";

/// @title PregradManager
/// @author Pop Charts
/// @notice Singleton manager for all Pop Charts pre-graduation markets.
contract PregradManager is Ownable, ReentrancyGuard, EIP712, CreationFeeVault, ReceiptBook {
  using SafeERC20 for IERC20;

  /// @notice Longest clearing challenge window the owner may configure.
  uint64 public constant MAX_CLEARING_CHALLENGE_PERIOD = 7 days;
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

  /// @notice Hard cap on the owner-configurable entry fee rate (10%), scaled by 1e18.
  uint256 public constant MAX_ENTRY_FEE_RATE_WAD = 1e17;
  /// @notice Hard cap on the owner-configurable withdrawal fee rate (10%), scaled by 1e18.
  /// @dev The entry fee's cap, deliberately: ADR 0014 §3 sets the operating
  ///      rate at 5% and defers calibration, so the cap leaves the same
  ///      headroom without a redeploy while bounding what a compromised owner
  ///      key can charge.
  uint256 public constant MAX_WITHDRAWAL_FEE_RATE_WAD = 1e17;
  /// @notice Longest withdrawal challenge window the owner may configure.
  uint64 public constant MAX_WITHDRAWAL_CHALLENGE_PERIOD = 7 days;
  /// @notice Maximum bytes allowed for the canonical metadata payload emitted at creation.
  uint256 public constant MAX_METADATA_BYTES = 8192;
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
  /// @notice Reverts when a market is created without canonical metadata.
  error InvalidMetadata();
  /// @notice Reverts when a market metadata payload is too large for the creation event.
  /// @param length Byte length supplied by the creator.
  /// @param maximum Maximum supported byte length.
  error MetadataTooLong(uint256 length, uint256 maximum);
  /// @notice Reverts when the graduation deadline is not in the future.
  error InvalidGraduationDeadline();
  /// @notice Reverts when the resolution deadline is not after the graduation deadline.
  error InvalidResolutionTime();
  /// @notice Reverts when the early-YES gate is outside (graduationDeadline, resolutionTime].
  error InvalidYesNotBefore();
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
  /// @notice Reverts when the quoted cost plus entry fee exceeds the buyer's maximum total debit.
  /// @param cost Current quoted receipt cost plus the entry fee due on it.
  /// @param maxCost Maximum total debit accepted by the buyer.
  error CostExceedsLimit(uint256 cost, uint256 maxCost);
  /// @notice Reverts when the owner sets an entry fee rate above the hard cap.
  /// @param rateWad Requested rate, scaled by 1e18.
  /// @param maximumRateWad Hard cap on the rate, scaled by 1e18.
  error EntryFeeRateExceedsMaximum(uint256 rateWad, uint256 maximumRateWad);
  /// @notice Reverts when earned entry fee withdrawal targets the zero account.
  error InvalidEntryFeeRecipient();
  /// @notice Reverts when earned entry fee withdrawal exceeds the earned balance.
  /// @param available Earned entry fees available for the market.
  /// @param requested Amount requested by the owner.
  error EntryFeeWithdrawalExceedsEarned(uint256 available, uint256 requested);
  /// @notice Reverts when the owner sets a withdrawal fee rate above the hard cap.
  /// @param rateWad Requested rate, scaled by 1e18.
  /// @param maximumRateWad Hard cap on the rate, scaled by 1e18.
  error WithdrawalFeeRateExceedsMaximum(uint256 rateWad, uint256 maximumRateWad);
  /// @notice Reverts when the owner configures a withdrawal challenge window beyond the maximum.
  /// @param period Challenge period supplied by the owner.
  /// @param maximum Longest supported challenge period.
  error InvalidWithdrawalChallengePeriod(uint64 period, uint64 maximum);
  /// @notice Reverts when a withdrawal request names an owner the receipt does not have.
  /// @param receiptId Receipt being withdrawn from.
  /// @param named Owner named by the request.
  /// @param actual Owner stored on the receipt.
  error InvalidWithdrawalOwner(uint256 receiptId, address named, address actual);
  /// @notice Reverts when a receipt already has a pending withdrawal request.
  /// @param receiptId Receipt with the pending request.
  /// @param requestId The pending request.
  error WithdrawalRequestAlreadyPending(uint256 receiptId, uint256 requestId);
  /// @notice Reverts when a withdrawal request claims no segments.
  /// @param receiptId Receipt the empty claim targeted.
  error NoWithdrawalSegments(uint256 receiptId);
  /// @notice Reverts when claimed segments are not ascending and disjoint.
  /// @param previousHigh Upper bound of the preceding claimed segment.
  /// @param rLow Lower bound of the out-of-order claimed segment.
  error UnorderedWithdrawalSegments(int256 previousHigh, int256 rLow);
  /// @notice Reverts when a withdrawal-request operation references an unknown request.
  /// @param requestId Request ID that does not exist.
  error WithdrawalRequestDoesNotExist(uint256 requestId);
  /// @notice Reverts when a withdrawal request has already been refuted or finalized.
  /// @param requestId Request that is no longer pending.
  /// @param status Current request status.
  error WithdrawalRequestNotPending(uint256 requestId, MarketTypes.WithdrawalRequestStatus status);
  /// @notice Reverts when a refutation arrives at or after the challenge deadline.
  /// @param requestId Request whose window has closed.
  /// @param challengeDeadline Timestamp the window closed at.
  error WithdrawalChallengeWindowClosed(uint256 requestId, uint64 challengeDeadline);
  /// @notice Reverts when finalization is attempted before the challenge deadline.
  /// @param requestId Request that is still challengeable.
  /// @param challengeDeadline Timestamp when finalization becomes available.
  error WithdrawalChallengeActive(uint256 requestId, uint64 challengeDeadline);
  /// @notice Reverts when a named receipt fails to refute a withdrawal claim.
  /// @param requestId Request the refutation targeted.
  /// @param refutingReceiptId Receipt that proved no claimed segment opposed.
  error WithdrawalClaimNotRefuted(uint256 requestId, uint256 refutingReceiptId);
  /// @notice Reverts when graduation starts while withdrawal requests are pending.
  /// @param marketId Market with pending withdrawal requests.
  /// @param pendingRequests Number of requests still pending.
  error PendingWithdrawalsBlockGraduation(uint256 marketId, uint256 pendingRequests);
  /// @notice Reverts when earned withdrawal fee withdrawal targets the zero account.
  error InvalidWithdrawalFeeRecipient();
  /// @notice Reverts when earned withdrawal fee withdrawal exceeds the earned balance.
  /// @param available Earned withdrawal fees available for the market.
  /// @param requested Amount requested by the owner.
  error WithdrawalFeeWithdrawalExceedsEarned(uint256 available, uint256 requested);
  /// @notice Reverts when an ERC20 transfer delivers less or more collateral than expected.
  /// @param expected Exact collateral amount that should have reached escrow.
  /// @param received Actual collateral amount observed by balance delta.
  error InvalidCollateralTransfer(uint256 expected, uint256 received);
  /// @notice Reverts when a market-scoped operation references an unknown market.
  /// @param marketId Market ID that does not exist.
  error MarketDoesNotExist(uint256 marketId);
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
  /// @notice Reverts when an account is not allowed to manage graduation.
  /// @param account Unauthorized account.
  error UnauthorizedGraduationManager(address account);
  /// @notice Reverts when authorized creation is attempted before an authorizer is set.
  error MarketCreationAuthorizerUnset();
  /// @notice Reverts when a creation authorization is past its expiry.
  /// @param expiry Timestamp the authorization stopped being valid.
  error MarketCreationAuthorizationExpired(uint64 expiry);
  /// @notice Reverts when a creation authorization nonce was already consumed.
  /// @param nonce The spent nonce.
  error MarketCreationAuthorizationNonceUsed(uint256 nonce);
  /// @notice Reverts when a creation authorization signature does not recover the authorizer.
  /// @param recovered Signer the signature actually recovered to.
  error InvalidMarketCreationAuthorization(address recovered);
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
  /// @notice Reverts when the owner configures a challenge window beyond the supported maximum.
  /// @param period Challenge period supplied by the owner.
  /// @param maximum Longest supported challenge period.
  error InvalidClearingChallengePeriod(uint64 period, uint64 maximum);
  /// @notice Reverts when finalization receives the zero postgrad adapter address.
  error InvalidPostgradAdapter();
  /// @notice The adapter reported an outcome capacity that does not match the clearing root.
  error PostgradCapacityMismatch(uint256 expected, uint256 actual);
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
  /// @param metadata Canonical JSON metadata payload emitted for indexers.
  /// @param collateral Collateral token accepted by the market.
  /// @param openingProbabilityWad Opening YES probability, scaled by 1e18.
  /// @param liquidityParameter Virtual LMSR smoothness parameter.
  /// @param graduationThreshold Minimum matched market cap required to graduate.
  /// @param graduationDeadline Timestamp by which the market must graduate or become refundable.
  /// @param resolutionTime Timestamp by which the postgrad market should resolve.
  /// @param yesNotBefore Earliest timestamp a YES resolution may be submitted on-chain.
  /// @param bypassAiResolution True when a trusted creator opted out of AI-assisted resolution.
  event MarketCreated(
    uint256 indexed marketId,
    address indexed creator,
    bytes32 indexed metadataHash,
    string metadata,
    address collateral,
    uint256 openingProbabilityWad,
    uint256 liquidityParameter,
    uint256 graduationThreshold,
    uint64 graduationDeadline,
    uint64 resolutionTime,
    uint64 yesNotBefore,
    bool bypassAiResolution
  );

  /// @notice Emitted when the owner grants or revokes trusted creator privileges.
  /// @param account Account whose trusted creator status changed.
  /// @param trusted True when the account may bypass public market creation guardrails.
  event TrustedCreatorUpdated(address indexed account, bool trusted);

  /// @notice Emitted when the owner rotates the market-creation authorizer key.
  /// @param previousAuthorizer Key being retired (address(0) on first arm).
  /// @param newAuthorizer Key whose signatures verify from now on.
  event MarketCreationAuthorizerUpdated(
    address indexed previousAuthorizer,
    address indexed newAuthorizer
  );

  /// @notice Emitted when the owner pauses or resumes new market creation.
  /// @param paused True when new market creation is paused.
  event MarketCreationPausedUpdated(bool paused);

  /// @notice Emitted when the owner changes the clearing challenge window.
  /// @param previousPeriod Challenge period replaced by this update.
  /// @param newPeriod Challenge period applied to future clearing root submissions.
  event ClearingChallengePeriodUpdated(uint64 previousPeriod, uint64 newPeriod);

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

  /// @notice Emitted when an owner cancels an active market for moderation and opens full refunds.
  /// @param marketId Market that was cancelled.
  /// @param totalEscrowed Escrow available for future refund claims.
  event MarketCancelled(uint256 indexed marketId, uint256 totalEscrowed);

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

  /// @notice Emitted when the owner changes the entry fee rate.
  /// @param previousRateWad Rate before the change, scaled by 1e18.
  /// @param newRateWad Rate after the change, scaled by 1e18.
  event EntryFeeRateUpdated(uint256 previousRateWad, uint256 newRateWad);

  /// @notice Emitted when an entry fee is collected alongside a receipt's cost.
  /// @param receiptId Receipt the fee was collected for.
  /// @param marketId Market that owns the receipt.
  /// @param payer Account that paid the fee.
  /// @param amount Fee amount collected, held refundable until clearing.
  event EntryFeeCollected(
    uint256 indexed receiptId,
    uint256 indexed marketId,
    address indexed payer,
    uint256 amount
  );

  /// @notice Emitted when a receipt's held entry fee is returned to its owner.
  /// @param receiptId Receipt whose fee was returned.
  /// @param marketId Market that owns the receipt.
  /// @param recipient Account receiving the fee.
  /// @param amount Fee amount returned.
  event EntryFeeRefunded(
    uint256 indexed receiptId,
    uint256 indexed marketId,
    address indexed recipient,
    uint256 amount
  );

  /// @notice Emitted when clearing earns the protocol a receipt's matched-share fee.
  /// @param receiptId Receipt whose matched cost earned the fee.
  /// @param marketId Market that owns the receipt.
  /// @param amount Fee amount earned.
  event EntryFeeEarned(uint256 indexed receiptId, uint256 indexed marketId, uint256 amount);

  /// @notice Emitted when the owner withdraws a market's earned entry fees.
  /// @param marketId Market whose earned fees were withdrawn.
  /// @param recipient Account receiving the fees.
  /// @param amount Fee amount withdrawn.
  event EarnedEntryFeesWithdrawn(
    uint256 indexed marketId,
    address indexed recipient,
    uint256 amount
  );

  /// @notice Emitted when the owner changes the withdrawal challenge window.
  /// @param previousPeriod Challenge period replaced by this update.
  /// @param newPeriod Challenge period applied to future withdrawal requests.
  event WithdrawalChallengePeriodUpdated(uint64 previousPeriod, uint64 newPeriod);

  /// @notice Emitted when the owner changes the withdrawal fee rate.
  /// @param previousRateWad Rate before the change, scaled by 1e18.
  /// @param newRateWad Rate after the change, scaled by 1e18.
  event WithdrawalFeeRateUpdated(uint256 previousRateWad, uint256 newRateWad);

  /// @notice Emitted when a withdrawal request removes claimed segments from live support.
  /// @dev Carries everything the indexer needs to replay the receipt mutation:
  ///      the claimed segments, the contract-priced amounts, and the stamped
  ///      window and snapshot (ADR 0014 P3).
  /// @param requestId Canonical withdrawal request ID.
  /// @param receiptId Receipt whose live support the claimed segments left.
  /// @param marketId Market that owns the receipt.
  /// @param owner Receipt owner the finalized refund will pay.
  /// @param segments Claimed segments, ascending and disjoint.
  /// @param grossRefund Recorded path cost of the claimed segments.
  /// @param withdrawalFee Fee at the request-time rate, kept at finalization.
  /// @param entryFeeRefund Pro-rated held entry fee returned at finalization.
  /// @param challengeDeadline Timestamp at or after which the request finalizes.
  /// @param nextReceiptIdSnapshot Refutation-set bound stamped at request time.
  event ReceiptWithdrawalRequested(
    uint256 indexed requestId,
    uint256 indexed receiptId,
    uint256 indexed marketId,
    address owner,
    MarketTypes.PathSegment[] segments,
    uint256 grossRefund,
    uint256 withdrawalFee,
    uint256 entryFeeRefund,
    uint64 challengeDeadline,
    uint256 nextReceiptIdSnapshot
  );

  /// @notice Emitted when a challenger refutes a pending withdrawal request.
  /// @param requestId Request that was refuted and cancelled.
  /// @param receiptId Receipt whose claimed segments were restored to live support.
  /// @param marketId Market that owns the receipt.
  /// @param challenger Account that submitted the refutation.
  /// @param refutingReceiptId Opposite-side receipt whose recorded coverage proved opposition.
  event ReceiptWithdrawalRefuted(
    uint256 indexed requestId,
    uint256 indexed receiptId,
    uint256 indexed marketId,
    address challenger,
    uint256 refutingReceiptId
  );

  /// @notice Emitted when an unchallenged withdrawal request pays out.
  /// @dev The amounts split the money movement exactly: `escrowRefund` plus
  ///      `withdrawalFee` leaves `totalEscrowed`, the fee stays as earned
  ///      protocol money, and `entryFeeRefund` leaves the held fee escrow.
  ///      The owner receives `escrowRefund + entryFeeRefund` in one transfer.
  /// @param requestId Request that finalized.
  /// @param receiptId Receipt the withdrawal settled against.
  /// @param marketId Market that owns the receipt.
  /// @param owner Account paid by the withdrawal.
  /// @param escrowRefund Escrowed cost returned to the owner, net of the fee.
  /// @param entryFeeRefund Held entry fee returned to the owner.
  /// @param withdrawalFee Fee earned by the protocol on the act.
  event ReceiptWithdrawalFinalized(
    uint256 indexed requestId,
    uint256 indexed receiptId,
    uint256 indexed marketId,
    address owner,
    uint256 escrowRefund,
    uint256 entryFeeRefund,
    uint256 withdrawalFee
  );

  /// @notice Emitted when a pending withdrawal request is voided because its
  ///   market left Active before finalization.
  /// @dev The claimed segments return to live support, the pending trackers
  ///      clear, and no fee is charged; the receipt's full cost and held
  ///      entry fee refund through `claimRefundedReceipt` instead
  ///      (ADR 0014 §3).
  /// @param requestId Request that was voided.
  /// @param receiptId Receipt whose claimed segments were restored.
  /// @param marketId Market that owns the receipt.
  event ReceiptWithdrawalVoided(
    uint256 indexed requestId,
    uint256 indexed receiptId,
    uint256 indexed marketId
  );

  /// @notice Emitted when the owner withdraws a market's earned withdrawal fees.
  /// @param marketId Market whose earned fees were withdrawn.
  /// @param recipient Account receiving the fees.
  /// @param amount Fee amount withdrawn.
  event EarnedWithdrawalFeesWithdrawn(
    uint256 indexed marketId,
    address indexed recipient,
    uint256 amount
  );

  uint256 private _nextMarketId = 1;
  mapping(uint256 marketId => MarketTypes.MarketRecord) private _markets;
  mapping(uint256 marketId => MarketTypes.ClearingRoot) private _clearingRoots;
  mapping(uint256 marketId => address) private _postgradAdapters;
  mapping(address account => bool trusted) private _trustedCreators;

  /// @notice Key whose EIP-712 signature admits an authorized market creation.
  /// @dev address(0) (the default) means no authorizations verify — the
  ///      authorized path reverts until the owner arms it. Deliberately a
  ///      separate key from the review managers: it outlives their retirement
  ///      (repo ADR 0022 P5) and its blast radius is creation, not review.
  address private _marketCreationAuthorizer;
  /// @dev Unordered single-use authorization nonces, global across creators;
  ///      the signed struct binds the creator, so global uniqueness is enough.
  mapping(uint256 nonce => bool used) private _usedCreationAuthorizationNonces;

  /// @notice Returns true when new market creation is paused.
  bool public marketCreationPaused;

  /// @notice Challenge window applied after an optimistic clearing root is submitted.
  /// @dev Zero (the default) disables the window while the graduation manager both
  /// computes and submits clearing roots. Set a nonzero period only once third
  /// parties can propose roots and an active dispute mechanism can check them.
  uint64 public clearingChallengePeriod;

  /// @notice Entry fee rate charged on a receipt's cost at placement, scaled by 1e18.
  /// @dev Zero (the default) charges nothing, so deploys are behaviour-preserving
  ///      until the owner arms the fee. The fee is a second escrow, not revenue:
  ///      it is earned only on a receipt's matched cost at clearing and refunds in
  ///      full when a market never graduates (protocol ADR 0014 §3).
  uint256 public entryFeeRateWad;

  /// @notice Refundable entry fees held for a market's active receipts.
  mapping(uint256 marketId => uint256) public marketEntryFeeEscrow;

  /// @notice Entry fees earned from a market's matched cost at clearing.
  /// @dev The per-market fee pot destined for post-graduation pool seeding
  ///      (ADR 0014 P5); owner-withdrawable until that path exists.
  mapping(uint256 marketId => uint256) public marketEntryFeesEarned;

  /// @notice The withdrawal mechanism's storage, operated by the
  ///   `ReceiptWithdrawals` external library (ADR 0014 P3).
  /// @dev The window and rate default to zero: the window stays disabled
  ///      while the graduation manager attests withdrawal claims off-chain
  ///      and relays them (mirroring the clearing window's ADR 0010 posture),
  ///      and the fee ships disarmed until the owner arms it. One pending
  ///      request per receipt at a time — the serialization is load-bearing
  ///      for the challenge path, whose restore then returns the receipt's
  ///      live support toward the shape the request removed from, never
  ///      exceeding the segment cap the removals enforced. Per-market
  ///      deadlines are monotone by construction: new deadlines clamp to the
  ///      market's latest, so a dependent claim can never finalize while the
  ///      claim that enabled it is still challengeable.
  ReceiptWithdrawals.Store private _withdrawals;

  /// @notice Initializes the contract owner as the first review and graduation manager.
  constructor() Ownable(msg.sender) EIP712("PregradManager", "1") {}

  /// @notice Restricts a function to the contract's current graduation manager set.
  modifier onlyGraduationManager() {
    _requireGraduationManager(msg.sender);
    _;
  }

  /// @notice Creates a market born Active under a server-minted authorization.
  /// @dev The only creation path (repo ADR 0022 P5 removed the ungated one):
  ///      review happens off-chain on the draft, the signature is the proof,
  ///      so there is no on-chain review stop. Trusted creators skip
  ///      verification entirely — pass a zeroed authorization — exactly as
  ///      they already skip the creation fee.
  /// @param params Market creation parameters, excluding creator.
  /// @param authorization Authorizer-signed permission binding these exact params.
  /// @return marketId Canonical pregrad market ID.
  function createMarket(
    MarketTypes.CreateMarketParams calldata params,
    MarketTypes.MarketCreationAuthorization calldata authorization
  ) external payable nonReentrant returns (uint256 marketId) {
    if (!isTrustedCreator(msg.sender)) {
      _consumeCreationAuthorization(params, authorization);
    }

    return _createMarket(params);
  }

  /// @dev EIP-712 type of the full creation params. Every economic field is
  ///      bound — signing only the metadataHash would let an approved question
  ///      ship with unreviewed numbers around it.
  bytes32 private constant CREATE_MARKET_PARAMS_TYPEHASH = keccak256(
    // solhint-disable-next-line max-line-length
    "CreateMarketParams(address collateral,bytes32 metadataHash,string metadata,uint256 openingProbabilityWad,uint256 liquidityParameter,uint256 graduationThreshold,uint64 graduationDeadline,uint64 resolutionTime,uint64 yesNotBefore,bool bypassAiResolution)"
  );

  /// @dev EIP-712 type of the authorization envelope; the referenced struct
  ///      type is appended per the standard's encodeType rules.
  bytes32 private constant MARKET_CREATION_AUTHORIZATION_TYPEHASH = keccak256(
    // solhint-disable-next-line max-line-length
    "MarketCreationAuthorization(address creator,CreateMarketParams params,uint256 nonce,uint64 expiry)CreateMarketParams(address collateral,bytes32 metadataHash,string metadata,uint256 openingProbabilityWad,uint256 liquidityParameter,uint256 graduationThreshold,uint64 graduationDeadline,uint64 resolutionTime,uint64 yesNotBefore,bool bypassAiResolution)"
  );

  /// @notice Verifies and spends a creation authorization for msg.sender.
  /// @dev Order matters for error quality: configuration (unset authorizer)
  ///      before time (expiry) before replay (nonce) before cryptography, so
  ///      the revert names the first thing the caller can actually fix.
  /// @param params The exact params the signature must cover.
  /// @param authorization The envelope being spent.
  function _consumeCreationAuthorization(
    MarketTypes.CreateMarketParams calldata params,
    MarketTypes.MarketCreationAuthorization calldata authorization
  ) private {
    address authorizer = _marketCreationAuthorizer;
    if (authorizer == address(0)) {
      revert MarketCreationAuthorizerUnset();
    }
    if (block.timestamp > authorization.expiry) {
      revert MarketCreationAuthorizationExpired(authorization.expiry);
    }
    if (_usedCreationAuthorizationNonces[authorization.nonce]) {
      revert MarketCreationAuthorizationNonceUsed(authorization.nonce);
    }

    bytes32 digest = _hashTypedDataV4(
      keccak256(
        abi.encode(
          MARKET_CREATION_AUTHORIZATION_TYPEHASH,
          msg.sender,
          _hashCreateMarketParams(params),
          authorization.nonce,
          authorization.expiry
        )
      )
    );
    address recovered = ECDSA.recover(digest, authorization.signature);
    if (recovered != authorizer) {
      revert InvalidMarketCreationAuthorization(recovered);
    }

    _usedCreationAuthorizationNonces[authorization.nonce] = true;
  }

  /// @notice EIP-712 struct hash of the full creation params.
  /// @param params Params being hashed; `metadata` hashes as keccak of its bytes.
  /// @return The hashStruct(CreateMarketParams) value.
  function _hashCreateMarketParams(
    MarketTypes.CreateMarketParams calldata params
  ) private pure returns (bytes32) {
    return
      keccak256(
        abi.encode(
          CREATE_MARKET_PARAMS_TYPEHASH,
          params.collateral,
          params.metadataHash,
          keccak256(bytes(params.metadata)),
          params.openingProbabilityWad,
          params.liquidityParameter,
          params.graduationThreshold,
          params.graduationDeadline,
          params.resolutionTime,
          params.yesNotBefore,
          params.bypassAiResolution
        )
      );
  }

  /// @notice Creation core: validates, collects the fee, and records the market.
  /// @param params Market creation parameters, excluding creator.
  /// @return marketId Canonical pregrad market ID.
  function _createMarket(
    MarketTypes.CreateMarketParams calldata params
  ) private returns (uint256 marketId) {
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
      yesNotBefore: params.yesNotBefore,
      bypassAiResolution: params.bypassAiResolution
    });
    market.state.status = MarketTypes.MarketStatus.Active;
    market.state.path = LmsrMath.openingPath(
      params.openingProbabilityWad,
      params.liquidityParameter
    );

    _emitMarketCreated(marketId, params);

    if (creationFee != 0) {
      emit MarketCreationFeePaid(marketId, msg.sender, creationFee);
    }
  }

  /// @notice Emits MarketCreated in a separate frame to keep createMarket within
  /// the EVM stack limit.
  /// @param marketId Newly assigned market ID.
  /// @param params Market creation parameters supplied by the creator.
  function _emitMarketCreated(
    uint256 marketId,
    MarketTypes.CreateMarketParams calldata params
  ) private {
    emit MarketCreated(
      marketId,
      msg.sender,
      params.metadataHash,
      params.metadata,
      params.collateral,
      params.openingProbabilityWad,
      params.liquidityParameter,
      params.graduationThreshold,
      params.graduationDeadline,
      params.resolutionTime,
      params.yesNotBefore,
      params.bypassAiResolution
    );
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

  /// @notice Sets the key whose signatures authorize market creation.
  /// @dev Single-setter rotation on purpose (repo ADR 0022 P4 decisions):
  ///      rotating invalidates every outstanding authorization, and the
  ///      15-minute mint window bounds that blast radius to a retry.
  /// @param authorizer New authorizer key; address(0) disarms the authorized path.
  function setMarketCreationAuthorizer(address authorizer) external onlyOwner {
    emit MarketCreationAuthorizerUpdated(_marketCreationAuthorizer, authorizer);
    _marketCreationAuthorizer = authorizer;
  }

  /// @notice Pauses or resumes new market creation.
  /// @param paused True to block `createMarket`; false to resume it.
  function setMarketCreationPaused(bool paused) external onlyOwner {
    marketCreationPaused = paused;
    emit MarketCreationPausedUpdated(paused);
  }

  /// @notice Sets the challenge window applied to future clearing root submissions.
  /// @param newPeriod Seconds between root submission and earliest finalization; zero disables the window.
  function setClearingChallengePeriod(uint64 newPeriod) external onlyOwner {
    if (newPeriod > MAX_CLEARING_CHALLENGE_PERIOD) {
      revert InvalidClearingChallengePeriod(newPeriod, MAX_CLEARING_CHALLENGE_PERIOD);
    }

    uint64 previousPeriod = clearingChallengePeriod;
    clearingChallengePeriod = newPeriod;

    emit ClearingChallengePeriodUpdated(previousPeriod, newPeriod);
  }

  /// @notice Withdraws collected market creation fees without touching receipt escrow.
  /// @param recipient Account receiving the fees.
  /// @param amount Fee amount to withdraw.
  function withdrawCreationFees(
    address payable recipient,
    uint256 amount
  ) external onlyOwner nonReentrant {
    _withdrawCreationFees(recipient, amount);
  }

  /// @notice Sets the entry fee rate charged on future receipt placements.
  /// @dev Receipts store the fee they actually paid, so a rate change never
  ///      alters what an existing receipt refunds or earns.
  /// @param newRateWad Fee rate scaled by 1e18; zero disables the fee.
  function setEntryFeeRate(uint256 newRateWad) external onlyOwner {
    if (newRateWad > MAX_ENTRY_FEE_RATE_WAD) {
      revert EntryFeeRateExceedsMaximum(newRateWad, MAX_ENTRY_FEE_RATE_WAD);
    }

    uint256 previousRateWad = entryFeeRateWad;
    entryFeeRateWad = newRateWad;

    emit EntryFeeRateUpdated(previousRateWad, newRateWad);
  }

  /// @notice Returns the entry fee due on a receipt cost at the current rate.
  /// @dev Full-precision mulDiv: a naive `cost * rate` product can overflow for
  ///      costs that are otherwise valid LMSR quotes, and an overflow here (or
  ///      in the claim-time split) would strand the receipt unclaimably.
  /// @param cost Receipt cost the fee is charged on.
  /// @return Fee amount, rounded down.
  function entryFeeFor(uint256 cost) public view returns (uint256) {
    return Math.mulDiv(cost, entryFeeRateWad, 1e18);
  }

  /// @notice Withdraws a market's earned entry fees without touching held fees or escrow.
  /// @dev Earned fees are the per-market pot destined for post-graduation pool
  ///      seeding (ADR 0014 P5); this is the interim disposition path.
  /// @param marketId Market whose earned fees to withdraw.
  /// @param recipient Account receiving the fees.
  /// @param amount Fee amount to withdraw; zero withdraws the full earned balance.
  function withdrawEarnedEntryFees(
    uint256 marketId,
    address recipient,
    uint256 amount
  ) external onlyOwner nonReentrant {
    _requireMarketExists(marketId);
    if (recipient == address(0)) {
      revert InvalidEntryFeeRecipient();
    }

    uint256 available = marketEntryFeesEarned[marketId];
    uint256 withdrawal = amount == 0 ? available : amount;
    if (withdrawal > available) {
      revert EntryFeeWithdrawalExceedsEarned(available, withdrawal);
    }

    marketEntryFeesEarned[marketId] = available - withdrawal;
    IERC20(_markets[marketId].config.collateral).safeTransfer(recipient, withdrawal);

    emit EarnedEntryFeesWithdrawn(marketId, recipient, withdrawal);
  }

  /// @notice Sets the challenge window applied to future withdrawal requests.
  /// @dev In-flight requests keep the deadline stamped at request time
  ///      (ADR 0010's pattern); a shortened period never reopens or shortens
  ///      an existing window, and the per-market monotone clamp keeps a later
  ///      request's deadline at or after every earlier one's.
  /// @param newPeriod Seconds between request and earliest finalization; zero disables the window.
  function setWithdrawalChallengePeriod(uint64 newPeriod) external onlyOwner {
    if (newPeriod > MAX_WITHDRAWAL_CHALLENGE_PERIOD) {
      revert InvalidWithdrawalChallengePeriod(newPeriod, MAX_WITHDRAWAL_CHALLENGE_PERIOD);
    }

    uint64 previousPeriod = _withdrawals.challengePeriod;
    _withdrawals.challengePeriod = newPeriod;

    emit WithdrawalChallengePeriodUpdated(previousPeriod, newPeriod);
  }

  /// @notice Sets the withdrawal fee rate charged on future withdrawal requests.
  /// @dev Requests store the fee stamped at request time, so a rate change
  ///      never alters what a pending request pays at finalization.
  /// @param newRateWad Fee rate scaled by 1e18; zero disables the fee.
  function setWithdrawalFeeRate(uint256 newRateWad) external onlyOwner {
    if (newRateWad > MAX_WITHDRAWAL_FEE_RATE_WAD) {
      revert WithdrawalFeeRateExceedsMaximum(newRateWad, MAX_WITHDRAWAL_FEE_RATE_WAD);
    }

    uint256 previousRateWad = _withdrawals.feeRateWad;
    _withdrawals.feeRateWad = newRateWad;

    emit WithdrawalFeeRateUpdated(previousRateWad, newRateWad);
  }

  /// @notice Returns the withdrawal fee due on a gross refund at the current rate.
  /// @dev The convention lives in `ReceiptWithdrawals.feeFor`, shared with the
  ///      request stamp: one full-precision mulDiv floored on the request's
  ///      whole gross — never per segment — so the payout cannot depend on
  ///      fragmentation and the on-chain fee always equals the P2 quote's
  ///      (`withdrawal-quote.ts` fixes the convention; ADR 0014 P4b).
  /// @param grossRefund Recorded cost the fee is charged on.
  /// @return Fee amount, rounded down.
  function withdrawalFeeFor(uint256 grossRefund) public view returns (uint256) {
    return ReceiptWithdrawals.feeFor(_withdrawals, grossRefund);
  }

  /// @notice Returns the challenge window applied to future withdrawal requests.
  /// @return Seconds between request and earliest finalization; zero disables the window.
  function withdrawalChallengePeriod() external view returns (uint64) {
    return _withdrawals.challengePeriod;
  }

  /// @notice Returns the withdrawal fee rate charged on future requests, scaled by 1e18.
  /// @return Fee rate; zero means the fee is disarmed.
  function withdrawalFeeRateWad() external view returns (uint256) {
    return _withdrawals.feeRateWad;
  }

  /// @notice Returns a receipt's pending withdrawal request, or zero when none.
  /// @param receiptId Receipt ID to read.
  /// @return Pending request ID, or zero.
  function pendingWithdrawalRequestOf(uint256 receiptId) external view returns (uint256) {
    return _withdrawals.pendingRequestOf[receiptId];
  }

  /// @notice Returns the number of withdrawal requests still pending for a market.
  /// @param marketId Market ID to read.
  /// @return Pending request count.
  function marketPendingWithdrawals(uint256 marketId) external view returns (uint256) {
    return _withdrawals.marketPendingRequests[marketId];
  }

  /// @notice Returns the withdrawal fees a market's finalized withdrawals earned.
  /// @dev Sibling of `marketEntryFeesEarned`, kept separate on purpose: entry
  ///      fees earn only at clearing while withdrawal fees earn on the act, so
  ///      merging the pots would hide that a cancelled market owes every entry
  ///      fee back while keeping every withdrawal fee. Also destined for
  ///      post-graduation pool seeding (ADR 0014 P5); owner-withdrawable until
  ///      that path exists.
  /// @param marketId Market ID to read.
  /// @return Earned withdrawal fees available for the market.
  function marketWithdrawalFeesEarned(uint256 marketId) public view returns (uint256) {
    return _withdrawals.marketFeesEarned[marketId];
  }

  /// @notice Withdraws a market's earned withdrawal fees without touching held fees or escrow.
  /// @dev Earned withdrawal fees are protocol money from the moment a request
  ///      finalizes — never refundable, on any market outcome (protocol
  ///      ADR 0014 §3) — and are destined for post-graduation pool seeding
  ///      (P5); this is the interim disposition path.
  /// @param marketId Market whose earned fees to withdraw.
  /// @param recipient Account receiving the fees.
  /// @param amount Fee amount to withdraw; zero withdraws the full earned balance.
  function withdrawEarnedWithdrawalFees(
    uint256 marketId,
    address recipient,
    uint256 amount
  ) external onlyOwner nonReentrant {
    _requireMarketExists(marketId);
    if (recipient == address(0)) {
      revert InvalidWithdrawalFeeRecipient();
    }

    uint256 available = _withdrawals.marketFeesEarned[marketId];
    uint256 withdrawal = amount == 0 ? available : amount;
    if (withdrawal > available) {
      revert WithdrawalFeeWithdrawalExceedsEarned(available, withdrawal);
    }

    _withdrawals.marketFeesEarned[marketId] = available - withdrawal;
    IERC20(_markets[marketId].config.collateral).safeTransfer(recipient, withdrawal);

    emit EarnedWithdrawalFeesWithdrawn(marketId, recipient, withdrawal);
  }

  /// @notice Returns the next market ID that will be assigned.
  /// @return Next market ID.
  function nextMarketId() external view returns (uint256) {
    return _nextMarketId;
  }

  /// @notice Returns the total number of markets created.
  /// @return Number of markets created by this manager.
  function marketCount() external view returns (uint256) {
    return _nextMarketId - 1;
  }

  /// @notice Returns whether `marketId` exists.
  /// @param marketId Market ID to check.
  /// @return True if the market exists.
  function marketExists(uint256 marketId) public view returns (bool) {
    return marketId != 0 && marketId < _nextMarketId;
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

  /// @notice Returns the key whose signatures authorize market creation.
  function marketCreationAuthorizer() external view returns (address) {
    return _marketCreationAuthorizer;
  }

  /// @notice Returns true when a creation authorization nonce is spent.
  /// @param nonce Nonce to check.
  function isCreationAuthorizationNonceUsed(uint256 nonce) external view returns (bool) {
    return _usedCreationAuthorizationNonces[nonce];
  }

  /// @notice Returns the market creation fee for `creator`.
  /// @param creator Account that would create a market.
  /// @return Native fee amount; zero for trusted creators.
  function marketCreationFee(address creator) public view returns (uint256) {
    return isTrustedCreator(creator) ? 0 : MARKET_CREATION_FEE;
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
    // `maxCost` bounds the buyer's total debit — cost plus entry fee — so an
    // owner rate change between transaction construction and execution can
    // only make the placement revert, never charge more than the buyer signed
    // up for. At a zero rate this is exactly the historical cost-only check.
    uint256 entryFee = entryFeeFor(quote.cost);
    if (quote.cost + entryFee > params.maxCost) {
      revert CostExceedsLimit(quote.cost + entryFee, params.maxCost);
    }

    receiptId = _allocateReceiptId();

    uint64 sequence = _storeReceipt(receiptId, market, params, quote, entryFee);

    // One transfer covers cost and fee; only the cost enters `totalEscrowed`,
    // so the graduation snapshot and clearing invariants never see the fee.
    _transferEscrow(IERC20(market.config.collateral), msg.sender, quote.cost + entryFee);

    if (entryFee != 0) {
      marketEntryFeeEscrow[params.marketId] += entryFee;
      emit EntryFeeCollected(receiptId, params.marketId, msg.sender, entryFee);
    }

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

  /// @notice Requests withdrawal of a receipt's unopposed segments, removing
  ///   them from live support now and paying after the challenge window
  ///   (ADR 0014 P3, the ADR 0006 optimistic shape).
  /// @dev Manager-only in v1, mirroring clearing's trust model exactly
  ///      (ADR 0006/0010): the receipt owner asks the API off-chain, the
  ///      manager verifies the claim with the P2 quote code and relays it, and
  ///      the challenge window is zero while the same party attests every
  ///      claim. At a zero window a request finalizes immediately with only
  ///      structural checks, so an owner-submitted false claim of an opposed
  ///      band would steal from escrow — the attester refusing to sign is the
  ///      zero-window defense, exactly as clearing's manager-submitted roots.
  ///      Funds always pay to the receipt owner, never the manager. Opening
  ///      submission to receipt owners needs the window on and challenge
  ///      bonds, both deferred as clearing's are; the surface already carries
  ///      the owner and stamps every trust-critical field itself so that
  ///      change is a gate change, not a reshape.
  ///
  ///      The contract verifies everything checkable from the receipt alone:
  ///      liveness, the owner cross-check, segment ordering, containment in
  ///      live support, and the refund — each segment priced by the same
  ///      closed-form band cost placement locked, so the refund is exactly
  ///      the claimed segments' recorded cost. The claim's one unverifiable
  ///      statement — no live opposite-side receipt covers these segments —
  ///      is deliberately not checked: it is an absence over an unenumerable
  ///      mapping, asserted optimistically and refutable in O(1) by
  ///      `refuteWithdrawalRequest`. Nothing moves money here; escrow, path,
  ///      and fee accounting all settle at `finalizeReceiptWithdrawal`.
  /// @param receiptId Receipt whose segments are withdrawn.
  /// @param owner Receipt owner the relayed claim names; must match storage.
  /// @param segments Segments asserted unopposed, ascending and disjoint.
  /// @return requestId Canonical withdrawal request ID.
  function requestReceiptWithdrawal(
    uint256 receiptId,
    address owner,
    MarketTypes.PathSegment[] calldata segments
  ) external onlyGraduationManager returns (uint256 requestId) {
    _requireReceiptExists(receiptId);
    MarketTypes.Receipt storage receipt = _receiptAt(receiptId);
    _requireActiveReceipt(receiptId, receipt);
    if (owner != receipt.owner) {
      revert InvalidWithdrawalOwner(receiptId, owner, receipt.owner);
    }

    MarketTypes.MarketRecord storage market = _markets[receipt.marketId];
    _requireActiveMarket(receipt.marketId, market);
    _requireBeforeGraduationDeadline(receipt.marketId, market.config.graduationDeadline);

    uint256 pendingRequestId = _withdrawals.pendingRequestOf[receiptId];
    if (pendingRequestId != 0) {
      revert WithdrawalRequestAlreadyPending(receiptId, pendingRequestId);
    }
    _requireOrderedWithdrawalSegments(receiptId, segments);

    requestId = ReceiptWithdrawals.request(
      _withdrawals,
      _receiptSupportAt(receiptId),
      receipt,
      receiptId,
      market.config.liquidityParameter,
      _nextReceiptIdSnapshot(),
      MAX_RECEIPT_SEGMENTS,
      segments
    );
    _emitWithdrawalRequested(requestId, segments);
  }

  /// @notice Refutes a pending withdrawal request by naming one opposite-side
  ///   receipt whose recorded coverage overlaps a claimed segment.
  /// @dev Permissionless from day one, strictly inside the window, and O(1)
  ///      in the book's size: the contract loads the named receipt and checks
  ///      market, side, liveness, and the snapshot bound, then intersects the
  ///      claim with the receipt's recorded coverage — live support plus its
  ///      own still-pending claimed segments, which stay recorded until
  ///      finalization exactly so a colluding opposer's withdrawal cannot
  ///      outrun refutation (ADR 0014 P3). The colluding-pair attack —
  ///      requesting both sides of an opposed band — therefore dies in order:
  ///      the first claim by the second's pending-recorded coverage, the
  ///      second by the restored first; the residual is clearing's
  ///      honest-watcher assumption, discharged at the v1 zero window by the
  ///      attesting manager refusing the false claim. Challenge bonds are
  ///      deferred exactly as clearing's are. A failed refutation reverts —
  ///      on-chain, an answer with no state change is a wasted transaction.
  /// @param requestId Pending request being refuted.
  /// @param refutingReceiptId Opposite-side receipt named as the counterexample.
  function refuteWithdrawalRequest(uint256 requestId, uint256 refutingReceiptId) external {
    MarketTypes.WithdrawalRequest storage request = _requireWithdrawalRequest(requestId);
    _requirePendingWithdrawalRequest(requestId, request);
    _requireActiveMarket(request.marketId, _markets[request.marketId]);
    if (block.timestamp >= request.challengeDeadline) {
      revert WithdrawalChallengeWindowClosed(requestId, request.challengeDeadline);
    }

    _requireReceiptExists(refutingReceiptId);
    bool refuted = ReceiptWithdrawals.refute(
      _withdrawals,
      requestId,
      refutingReceiptId,
      _receiptAt(refutingReceiptId),
      _receiptAt(request.receiptId).side,
      _receiptSupportAt(request.receiptId),
      _liveReceiptSegments(refutingReceiptId)
    );
    if (!refuted) {
      revert WithdrawalClaimNotRefuted(requestId, refutingReceiptId);
    }

    emit ReceiptWithdrawalRefuted(
      requestId,
      request.receiptId,
      request.marketId,
      msg.sender,
      refutingReceiptId
    );
  }

  /// @notice Finalizes an unchallenged withdrawal request at or after its
  ///   deadline, paying the owner and settling all accounting.
  /// @dev Permissionless. Pays `grossRefund - withdrawalFee + entryFeeRefund`
  ///      to the stamped owner: the fee is earned on the act (ADR 0014 §3),
  ///      and the withdrawn segments' prepaid entry fee returns because an
  ///      unopposed band never matched, so the fee on it was never earned.
  ///      Requires the market still Active: a pending request on a market
  ///      that reached Refunded or Cancelled is voided instead —
  ///      automatically by `claimRefundedReceipt`, or by anyone through
  ///      `voidWithdrawalRequest` — and the full receipt, cost and held
  ///      entry fee alike, refunds with no withdrawal fee charged.
  ///      Graduation can never strand a request the other way, because
  ///      `startGraduation` reverts while any request is pending.
  /// @param requestId Pending request being finalized.
  function finalizeReceiptWithdrawal(uint256 requestId) external nonReentrant {
    MarketTypes.WithdrawalRequest storage request = _requireWithdrawalRequest(requestId);
    _requirePendingWithdrawalRequest(requestId, request);
    MarketTypes.MarketRecord storage market = _markets[request.marketId];
    _requireActiveMarket(request.marketId, market);
    if (block.timestamp < request.challengeDeadline) {
      revert WithdrawalChallengeActive(requestId, request.challengeDeadline);
    }

    uint256 escrowRefund = ReceiptWithdrawals.finalize(
      _withdrawals,
      requestId,
      _receiptAt(request.receiptId),
      market.state,
      marketEntryFeeEscrow
    );

    uint256 payout = escrowRefund + request.entryFeeRefund;
    if (payout != 0) {
      IERC20(market.config.collateral).safeTransfer(request.owner, payout);
    }

    emit ReceiptWithdrawalFinalized(
      requestId,
      request.receiptId,
      request.marketId,
      request.owner,
      escrowRefund,
      request.entryFeeRefund,
      request.withdrawalFee
    );
  }

  /// @notice Voids a pending withdrawal request whose market left Active
  ///   before finalization.
  /// @dev Permissionless: once the market is Refunded or Cancelled the
  ///      request can never finalize or be refuted, so anyone may sweep it —
  ///      restoring the claimed segments, clearing the pending trackers, and
  ///      emitting `ReceiptWithdrawalVoided`. `claimRefundedReceipt` runs the
  ///      same void automatically, so this entry point only mops up requests
  ///      whose owners never claim.
  /// @param requestId Pending request being voided.
  function voidWithdrawalRequest(uint256 requestId) external {
    MarketTypes.WithdrawalRequest storage request = _requireWithdrawalRequest(requestId);
    _requirePendingWithdrawalRequest(requestId, request);
    _requireRefundClaimableMarket(request.marketId, _markets[request.marketId]);

    _voidWithdrawalRequest(requestId, request);
  }

  /// @notice Voids a pending request through the library and emits.
  /// @param requestId Pending request being voided.
  /// @param request Stored request being voided.
  function _voidWithdrawalRequest(
    uint256 requestId,
    MarketTypes.WithdrawalRequest storage request
  ) private {
    ReceiptWithdrawals.voidRequest(_withdrawals, requestId, _receiptSupportAt(request.receiptId));

    emit ReceiptWithdrawalVoided(requestId, request.receiptId, request.marketId);
  }

  /// @notice Returns the next withdrawal request ID that will be assigned.
  /// @return Next withdrawal request ID.
  function nextWithdrawalRequestId() external view returns (uint256) {
    return _withdrawals.requestCount + 1;
  }

  /// @notice Returns a stored withdrawal request by ID.
  /// @param requestId Withdrawal request ID to read.
  /// @return Stored withdrawal request, claimed segments included.
  function getWithdrawalRequest(
    uint256 requestId
  ) external view returns (MarketTypes.WithdrawalRequest memory) {
    return _requireWithdrawalRequest(requestId);
  }

  /// @notice Requires a withdrawal claim to be nonempty, ascending, and disjoint.
  /// @param receiptId Receipt the claim targets, for the empty-claim error.
  /// @param segments Claimed segments being validated.
  function _requireOrderedWithdrawalSegments(
    uint256 receiptId,
    MarketTypes.PathSegment[] calldata segments
  ) private pure {
    if (segments.length == 0) {
      revert NoWithdrawalSegments(receiptId);
    }

    int256 previousHigh = type(int256).min;
    for (uint256 i = 0; i < segments.length; ++i) {
      if (segments[i].rLow < previousHigh) {
        revert UnorderedWithdrawalSegments(previousHigh, segments[i].rLow);
      }
      previousHigh = segments[i].rHigh;
    }
  }

  /// @notice Emits ReceiptWithdrawalRequested in a separate frame to keep
  ///   requestReceiptWithdrawal within the EVM stack limit.
  /// @param requestId Stored request to announce.
  /// @param segments Claimed segments as submitted.
  function _emitWithdrawalRequested(
    uint256 requestId,
    MarketTypes.PathSegment[] calldata segments
  ) private {
    MarketTypes.WithdrawalRequest storage request = _withdrawals.requests[requestId];
    emit ReceiptWithdrawalRequested(
      requestId,
      request.receiptId,
      request.marketId,
      request.owner,
      segments,
      request.grossRefund,
      request.withdrawalFee,
      request.entryFeeRefund,
      request.challengeDeadline,
      request.nextReceiptIdSnapshot
    );
  }

  /// @notice Requires a withdrawal request ID to exist.
  /// @param requestId Withdrawal request ID to check.
  /// @return request Stored withdrawal request.
  function _requireWithdrawalRequest(
    uint256 requestId
  ) private view returns (MarketTypes.WithdrawalRequest storage request) {
    request = _withdrawals.requests[requestId];
    if (request.status == MarketTypes.WithdrawalRequestStatus.None) {
      revert WithdrawalRequestDoesNotExist(requestId);
    }
  }

  /// @notice Requires a withdrawal request to still be pending.
  /// @param requestId Withdrawal request ID being guarded.
  /// @param request Stored withdrawal request being guarded.
  function _requirePendingWithdrawalRequest(
    uint256 requestId,
    MarketTypes.WithdrawalRequest storage request
  ) private view {
    if (request.status != MarketTypes.WithdrawalRequestStatus.Pending) {
      revert WithdrawalRequestNotPending(requestId, request.status);
    }
  }

  /// @notice Locks an active market's receipt book while the offchain service computes clearing.
  /// @dev Reverts while any withdrawal request is pending: the frozen book
  ///      must be deterministic, and a pending request holds segments out of
  ///      live support with their money still in escrow (ADR 0014 P3's
  ///      freeze rule). At the v1 zero window this is trivial — the manager
  ///      finalizes matured requests and starts graduation in the next
  ///      transaction — and requests are manager-only, so no third party can
  ///      hold graduation open. Revisit alongside owner-submitted requests.
  /// @param marketId Market entering the Graduating lifecycle state.
  /// @return snapshotHash Hash of the locked market state.
  function startGraduation(
    uint256 marketId
  ) external onlyGraduationManager returns (bytes32 snapshotHash) {
    _requireMarketExists(marketId);

    MarketTypes.MarketRecord storage market = _markets[marketId];
    _requireActiveMarket(marketId, market);
    _requireBeforeGraduationDeadline(marketId, market.config.graduationDeadline);

    uint256 pendingWithdrawals = _withdrawals.marketPendingRequests[marketId];
    if (pendingWithdrawals != 0) {
      revert PendingWithdrawalsBlockGraduation(marketId, pendingWithdrawals);
    }

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
    uint64 challengeDeadline = submittedAt + clearingChallengePeriod;

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
    (address postgradMarket, uint256 outcomeCapacity) = IPostgradAdapter(postgradAdapter)
      .prepareMarket(
        marketId,
        market.config.collateral,
        market.config.metadataHash,
        clearingRoot.retainedCostTotal,
        clearingRoot.completeSetCount,
        market.config.yesNotBefore,
        market.config.resolutionTime
      );
    if (outcomeCapacity != clearingRoot.completeSetCount) {
      revert PostgradCapacityMismatch(clearingRoot.completeSetCount, outcomeCapacity);
    }
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
    MarketTypes.Receipt storage receipt = _receiptAt(claim.receiptId);
    _validateReceiptClaim(claim, receipt);
    _verifyReceiptClaim(claim, proof, _requireClearingRoot(claim.marketId));

    receipt.active = false;
    market.state.totalEscrowed -= claim.refund;

    // The fee splits along the same line clearing drew on the cost: the share
    // prepaid on refunded cost returns with it, the share on retained cost is
    // earned. Floor division sends rounding dust to earned, never to refund,
    // and `retainedCost + refund == cost` (checked above) bounds the refund by
    // the fee paid. `entryFeeRefund` reaches zero exactly when the receipt
    // filled completely (protocol ADR 0014 §3).
    uint256 entryFeeRefund = 0;
    uint256 entryFeePaid = receipt.entryFeePaid;
    if (entryFeePaid != 0) {
      entryFeeRefund = Math.mulDiv(entryFeePaid, claim.refund, receipt.cost);
      uint256 entryFeeEarned = entryFeePaid - entryFeeRefund;
      marketEntryFeeEscrow[claim.marketId] -= entryFeePaid;
      if (entryFeeEarned != 0) {
        marketEntryFeesEarned[claim.marketId] += entryFeeEarned;
        emit EntryFeeEarned(claim.receiptId, claim.marketId, entryFeeEarned);
      }
      if (entryFeeRefund != 0) {
        emit EntryFeeRefunded(claim.receiptId, claim.marketId, claim.owner, entryFeeRefund);
      }
    }

    address postgradAdapter = _postgradAdapters[claim.marketId];
    if (claim.retainedShares != 0) {
      IPostgradAdapter(postgradAdapter).distributeOutcome(
        claim.marketId,
        claim.owner,
        claim.side,
        claim.retainedShares
      );
    }
    if (claim.refund + entryFeeRefund != 0) {
      IERC20(market.config.collateral).safeTransfer(claim.owner, claim.refund + entryFeeRefund);
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

  /// @notice Cancels an active market for content moderation and opens full refunds.
  /// @dev Owner-only kill switch for an inappropriate market that already went
  ///      Active with bettor escrow. Unlike `markRefundable` it is not gated on
  ///      the graduation deadline, so a live market can be stopped immediately.
  ///      Refunds flow through the same `claimRefundedReceipt` path; the distinct
  ///      Cancelled status separates "removed by moderation" from "missed
  ///      deadline". See protocol ADR 0011.
  /// @param marketId Market to cancel.
  function cancelMarket(uint256 marketId) external onlyOwner {
    _requireMarketExists(marketId);

    MarketTypes.MarketRecord storage market = _markets[marketId];
    _requireActiveMarket(marketId, market);

    market.state.status = MarketTypes.MarketStatus.Cancelled;

    emit MarketCancelled(marketId, market.state.totalEscrowed);
  }

  /// @notice Refunds a receipt from a market that missed graduation or was cancelled.
  /// @dev The entry fee returns in full alongside the cost: it is a success fee,
  ///      earned only at clearing on matched cost, and this market never cleared
  ///      (protocol ADR 0014 §3). A pending withdrawal request is voided first
  ///      — its claimed segments restore and no fee is charged — so the refund
  ///      always pays the receipt's full remaining cost and held entry fee.
  /// @param receiptId Receipt whose full escrowed cost should be returned.
  function claimRefundedReceipt(uint256 receiptId) external nonReentrant {
    _requireReceiptExists(receiptId);

    MarketTypes.Receipt storage receipt = _receiptAt(receiptId);
    MarketTypes.MarketRecord storage market = _markets[receipt.marketId];
    _requireRefundClaimableMarket(receipt.marketId, market);
    _requireActiveReceipt(receiptId, receipt);

    uint256 pendingRequestId = _withdrawals.pendingRequestOf[receiptId];
    if (pendingRequestId != 0) {
      _voidWithdrawalRequest(pendingRequestId, _withdrawals.requests[pendingRequestId]);
    }

    receipt.active = false;
    market.state.totalEscrowed -= receipt.cost;

    uint256 entryFee = receipt.entryFeePaid;
    if (entryFee != 0) {
      marketEntryFeeEscrow[receipt.marketId] -= entryFee;
      emit EntryFeeRefunded(receiptId, receipt.marketId, receipt.owner, entryFee);
    }

    IERC20(market.config.collateral).safeTransfer(receipt.owner, receipt.cost + entryFee);

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
    MarketTypes.ReceiptQuote memory quote,
    uint256 entryFee
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

    _insertReceipt(receiptId, msg.sender, params, quote, entryFee, sequence);
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
    uint256 metadataLength = bytes(params.metadata).length;
    if (metadataLength == 0) {
      revert InvalidMetadata();
    }
    if (metadataLength > MAX_METADATA_BYTES) {
      revert MetadataTooLong(metadataLength, MAX_METADATA_BYTES);
    }
    if (keccak256(bytes(params.metadata)) != params.metadataHash) {
      revert InvalidMetadataHash();
    }
    if (params.graduationDeadline <= block.timestamp) {
      revert InvalidGraduationDeadline();
    }
    if (params.resolutionTime <= params.graduationDeadline) {
      revert InvalidResolutionTime();
    }
    // Early-YES gate must sit strictly after graduation and no later than the
    // resolution deadline. Equal to resolutionTime means no early YES.
    if (
      params.yesNotBefore <= params.graduationDeadline ||
      params.yesNotBefore > params.resolutionTime
    ) {
      revert InvalidYesNotBefore();
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

  /// @notice Requires a market to be refund-claimable: Refunded (missed
  ///         deadline) or Cancelled (removed by moderation). Both open full
  ///         receipt refunds through the same claim path (protocol ADR 0011).
  /// @param marketId Market ID being guarded.
  /// @param market Market storage record being guarded.
  function _requireRefundClaimableMarket(
    uint256 marketId,
    MarketTypes.MarketRecord storage market
  ) private view {
    MarketTypes.MarketStatus status = market.state.status;
    if (
      status != MarketTypes.MarketStatus.Refunded && status != MarketTypes.MarketStatus.Cancelled
    ) {
      revert InvalidMarketStatus(marketId, status, MarketTypes.MarketStatus.Refunded);
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

  /// @notice Requires a market ID to exist.
  /// @param marketId Market ID to check.
  function _requireMarketExists(uint256 marketId) private view {
    if (!marketExists(marketId)) {
      revert MarketDoesNotExist(marketId);
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
}
