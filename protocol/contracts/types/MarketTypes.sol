// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title MarketTypes
/// @author Pop Charts
/// @notice Shared protocol types for virtual LMSR bootstrap markets.
library MarketTypes {
  /// @notice Binary side for a pre-graduation receipt or post-graduation outcome claim.
  enum Side {
    /// @notice The market's YES outcome.
    Yes,
    /// @notice The market's NO outcome.
    No
  }

  /// @notice Lifecycle status for a market managed by the pregrad singleton.
  /// @notice One-way market lifecycle. Every status-changing function in
  ///         `PregradManager` guards on a specific *pre-terminal* status
  ///         (startGraduation, markRefundable, and cancelMarket require
  ///         Active; finalizeGraduation requires Graduating; markets are born
  ///         Active — review happens off-chain on drafts, repo ADR 0022).
  ///         Consequently the terminal statuses — Graduated,
  ///         Refunded, Cancelled — can NEVER transition again: no
  ///         function accepts them as a precursor. Once a market is refunded or
  ///         cancelled it is final; only per-receipt refund claims remain, and
  ///         those flip `receipt.active`, never the market status. Any new
  ///         status-changing function MUST preserve this — do not accept a
  ///         terminal status as a precursor. (Covered by
  ///         `test_RefundedMarketStatusIsTerminal`.)
  enum MarketStatus {
    /// @notice The market accepts locked pre-graduation receipts priced by virtual LMSR.
    Active,
    /// @notice The market is suspicious or manually paused; reserved for future use.
    Frozen,
    /// @notice The receipt book is locked while the offchain clearing service computes graduation.
    Graduating,
    /// @notice Terminal. Clearing finalized and matched receipt segments can claim postgrad outcome tokens.
    Graduated,
    /// @notice Terminal. The market did not graduate and full receipt escrow is refundable — status never changes again.
    Refunded,
    /// @notice The postgrad outcome has been resolved.
    Resolved,
    /// @notice Terminal. The market was cancelled (moderation) and full receipt escrow is refundable — status never changes again.
    Cancelled
  }

  /// @notice Immutable creation-time configuration for a pregrad market.
  struct MarketConfig {
    /// @notice ERC20 collateral token escrowed by receipt buyers.
    address collateral;
    /// @notice Account that created the market.
    address creator;
    /// @notice Hash of market metadata, sources, and resolution rules.
    bytes32 metadataHash;
    /// @notice Initial YES probability, scaled by 1e18 and strictly between 0 and 1e18.
    uint256 openingProbabilityWad;
    /// @notice Virtual LMSR smoothness parameter `b`, scaled in collateral units.
    uint256 liquidityParameter;
    /// @notice Minimum matched market cap required before the market can graduate.
    uint256 graduationThreshold;
    /// @notice Deadline after which an ungraduated market becomes refundable.
    uint64 graduationDeadline;
    /// @notice Unix timestamp by which the postgrad market should resolve.
    uint64 resolutionTime;
    /// @notice Earliest timestamp a YES resolution may be submitted on-chain.
    /// Must satisfy graduationDeadline < yesNotBefore <= resolutionTime. Set
    /// earlier than resolutionTime only for open-ended markets that admit an
    /// early YES; equal to resolutionTime means no early YES.
    uint64 yesNotBefore;
    /// @notice True when a trusted creator opts out of AI-assisted resolution.
    bool bypassAiResolution;
  }

  /// @notice Inputs required to create a market.
  /// @dev The creator is intentionally omitted and derived from `msg.sender`.
  struct CreateMarketParams {
    /// @notice ERC20 collateral token escrowed by receipt buyers.
    address collateral;
    /// @notice Hash of market metadata, sources, and resolution rules.
    bytes32 metadataHash;
    /// @notice Canonical JSON metadata payload emitted for indexers.
    string metadata;
    /// @notice Initial YES probability, scaled by 1e18 and strictly between 0 and 1e18.
    uint256 openingProbabilityWad;
    /// @notice Virtual LMSR smoothness parameter `b`, scaled in collateral units.
    uint256 liquidityParameter;
    /// @notice Minimum matched market cap required before the market can graduate.
    uint256 graduationThreshold;
    /// @notice Deadline after which an ungraduated market becomes refundable.
    uint64 graduationDeadline;
    /// @notice Unix timestamp by which the postgrad market should resolve.
    uint64 resolutionTime;
    /// @notice Earliest timestamp a YES resolution may be submitted on-chain.
    /// Must satisfy graduationDeadline < yesNotBefore <= resolutionTime. Set
    /// earlier than resolutionTime only for open-ended markets that admit an
    /// early YES; equal to resolutionTime means no early YES.
    uint64 yesNotBefore;
    /// @notice True when a trusted creator opts out of AI-assisted resolution.
    bool bypassAiResolution;
  }

  /// @notice Server-minted permission to create one specific market (repo ADR 0022 P4).
  /// @dev EIP-712-signed by the manager's creation authorizer over the creator,
  ///      the full `CreateMarketParams`, the nonce, and the expiry — so no field
  ///      of the reviewed market can be swapped after approval, and the
  ///      signature is inert from any other sender. Nonces are unordered and
  ///      single-use: any unused value spends, so a creator's publishes never
  ///      queue behind each other. Expiry is minutes, not days — the params
  ///      carry absolute deadlines resolved at mint time, and the window bounds
  ///      how far those dates can drift from what was reviewed.
  struct MarketCreationAuthorization {
    /// @notice Arbitrary single-use value; consumed on successful creation.
    uint256 nonce;
    /// @notice Unix timestamp after which the authorization is unusable.
    uint64 expiry;
    /// @notice Authorizer's EIP-712 signature over the typed authorization.
    bytes signature;
  }

  /// @notice Mutable lifecycle and accounting state for a market.
  struct MarketState {
    /// @notice Current lifecycle status.
    MarketStatus status;
    /// @notice Number of receipts created for this market.
    uint256 receiptCount;
    /// @notice Total collateral currently escrowed by active receipts.
    uint256 totalEscrowed;
    /// @notice Current one-dimensional LMSR path coordinate.
    int256 path;
    /// @notice Total provisional YES shares recorded for this market.
    uint256 yesShares;
    /// @notice Total provisional NO shares recorded for this market.
    uint256 noShares;
    /// @notice Unix timestamp when graduation started, or zero if not graduating/graduated.
    uint64 graduationStartedAt;
  }

  /// @notice Full stored record for a pregrad market.
  struct MarketRecord {
    /// @notice Immutable creation-time market configuration.
    MarketConfig config;
    /// @notice Mutable market lifecycle and accounting state.
    MarketState state;
  }

  /// @notice Inputs required to place a locked pre-graduation receipt.
  struct PlaceReceiptParams {
    /// @notice Market that will receive the receipt.
    uint256 marketId;
    /// @notice YES or NO side to buy.
    Side side;
    /// @notice Provisional share quantity to sweep through the virtual LMSR.
    uint256 shares;
    /// @notice Maximum total collateral the buyer will part with: the receipt's
    ///   escrowed cost plus its entry fee. Bounding the whole debit means an
    ///   owner fee-rate change mid-flight can only revert a placement, never
    ///   charge more than the buyer authorized.
    uint256 maxCost;
  }

  /// @notice Current LMSR quote for a prospective receipt.
  struct ReceiptQuote {
    /// @notice Collateral that must be escrowed if the receipt is placed now.
    uint256 cost;
    /// @notice Lower bound of the LMSR path interval the receipt would traverse.
    int256 rLow;
    /// @notice Upper bound of the LMSR path interval the receipt would traverse.
    int256 rHigh;
  }

  /// @notice One half-open interval `[rLow, rHigh)` of a receipt's live
  ///   support on the LMSR path coordinate (whitepaper v0.6 §4: a receipt's
  ///   live support is a finite union of disjoint intervals once bands are
  ///   withdrawn). Touching endpoints do not overlap — `ReceiptBands.overlaps`
  ///   and the off-chain split in `opposed-set.ts` share this convention.
  struct PathSegment {
    /// @notice Lower bound of the segment on the LMSR path coordinate.
    int256 rLow;
    /// @notice Upper bound of the segment on the LMSR path coordinate.
    int256 rHigh;
  }

  /// @notice Stored record for one locked pre-graduation priced intent.
  /// @dev `rLow`/`rHigh` record the placement-time path interval and never
  ///      change. The receipt's live support starts as that single interval
  ///      and can only shrink; `ReceiptBook` tracks it as a segment list
  ///      (protocol ADR 0014 P1).
  struct Receipt {
    /// @notice Market that owns the receipt.
    uint256 marketId;
    /// @notice Account that owns the receipt and will claim tokens/refund after clearing.
    address owner;
    /// @notice YES or NO side purchased by the receipt.
    Side side;
    /// @notice Provisional share quantity swept by the receipt.
    uint256 shares;
    /// @notice Collateral paid and escrowed for the receipt's exact path cost.
    uint256 cost;
    /// @notice Entry fee collected at placement, held refundable until clearing.
    /// @dev Stored rather than derived so a later rate change cannot repay the
    ///      wrong amount on an old receipt (protocol ADR 0014 §3).
    uint256 entryFeePaid;
    /// @notice Lower bound of the LMSR path interval traversed by the receipt.
    int256 rLow;
    /// @notice Upper bound of the LMSR path interval traversed by the receipt.
    int256 rHigh;
    /// @notice Per-market creation sequence used for deterministic indexing and tie-breaks.
    uint64 sequence;
    /// @notice Whether the receipt remains active for future clearing or refund.
    bool active;
  }

  /// @notice Segment-list overlay for one receipt's live support (ADR 0014 P1).
  struct ReceiptSupport {
    /// @notice True once a band has been removed; `segments` is then the
    ///   receipt's live support, including when it is empty. While false the
    ///   live support is the placement interval `[rLow, rHigh]` and nothing
    ///   is stored here.
    bool segmented;
    /// @notice Live-support segments: ascending, disjoint, non-touching,
    ///   positive-width.
    PathSegment[] segments;
  }

  /// @notice Lifecycle of one optimistic receipt-withdrawal request (ADR 0014 P3).
  /// @dev A request on a market that leaves Active before finalization keeps
  ///      its Pending status but is void: finalization and refutation both
  ///      require the market Active, and the full receipt — cost and held
  ///      entry fee — refunds through `claimRefundedReceipt` instead.
  enum WithdrawalRequestStatus {
    /// @notice No request exists under this ID.
    None,
    /// @notice Claimed segments left live support; refutable until the deadline, payable after it.
    Pending,
    /// @notice Terminal. A challenger proved opposition and the claimed segments were restored.
    Refuted,
    /// @notice Terminal. The window elapsed unchallenged and the refund was paid.
    Finalized
  }

  /// @notice One stored optimistic withdrawal request (ADR 0014 P3).
  /// @dev Every field is contract-stamped at request time — the requester
  ///      supplies only the receipt, the owner cross-check, and the claimed
  ///      segments. Amounts are stored, never re-derived at finalization, so
  ///      an owner rate change mid-window cannot alter what a request pays
  ///      (the entry fee's store-don't-derive rule, ADR 0014 §3).
  struct WithdrawalRequest {
    /// @notice Receipt whose live support the claimed segments left.
    uint256 receiptId;
    /// @notice Market that owns the receipt.
    uint256 marketId;
    /// @notice Receipt owner at request time; the only account ever paid.
    address owner;
    /// @notice Timestamp at or after which an unchallenged request finalizes.
    uint64 challengeDeadline;
    /// @notice Current request lifecycle status.
    WithdrawalRequestStatus status;
    /// @notice Recorded path cost of the claimed segments.
    uint256 grossRefund;
    /// @notice Withdrawal fee at the request-time rate, kept at finalization.
    uint256 withdrawalFee;
    /// @notice Pro-rated share of the receipt's held entry fee returned at finalization.
    uint256 entryFeeRefund;
    /// @notice `nextReceiptId` read at request time. Receipts allocated at or
    ///   after it were placed after the claimed segments left the live book
    ///   and cannot refute the claim.
    uint256 nextReceiptIdSnapshot;
    /// @notice The claimed segments, recorded here until the request settles.
    PathSegment[] segments;
  }

  /// @notice Inputs required to submit an optimistic offchain clearing root.
  struct SubmitClearingRootParams {
    /// @notice Market whose locked receipt book was cleared offchain.
    uint256 marketId;
    /// @notice Merkle root of per-receipt claim outcomes.
    bytes32 merkleRoot;
    /// @notice Path-compatible filled market cap proven by the offchain clearing run.
    uint256 matchedMarketCap;
    /// @notice Sum of retained cost across all receipt claim leaves.
    uint256 retainedCostTotal;
    /// @notice Sum of refund amounts across all receipt claim leaves.
    uint256 refundTotal;
    /// @notice Number of complete sets represented by the retained matched exposure.
    uint256 completeSetCount;
  }

  /// @notice Stored optimistic clearing commitment for a graduating market.
  struct ClearingRoot {
    /// @notice Merkle root of per-receipt claim outcomes.
    bytes32 merkleRoot;
    /// @notice Account that submitted the clearing root.
    address submitter;
    /// @notice Snapshot hash of the locked market state this root clears.
    bytes32 snapshotHash;
    /// @notice Timestamp when the root was submitted.
    uint64 submittedAt;
    /// @notice Timestamp after which a valid unchallenged root may be finalized.
    uint64 challengeDeadline;
    /// @notice Path-compatible filled market cap proven by the offchain clearing run.
    uint256 matchedMarketCap;
    /// @notice Sum of retained cost across all receipt claim leaves.
    uint256 retainedCostTotal;
    /// @notice Sum of refund amounts across all receipt claim leaves.
    uint256 refundTotal;
    /// @notice Number of complete sets represented by the retained matched exposure.
    uint256 completeSetCount;
  }

  /// @notice Per-receipt claim payload committed by a clearing root leaf.
  struct ReceiptClaim {
    /// @notice Market that owns the receipt.
    uint256 marketId;
    /// @notice Receipt being settled.
    uint256 receiptId;
    /// @notice Account that owns the receipt.
    address owner;
    /// @notice YES or NO side purchased by the receipt.
    Side side;
    /// @notice Retained shares that graduate into postgrad outcome tokens.
    uint256 retainedShares;
    /// @notice Retained cost assigned to graduated path segments.
    uint256 retainedCost;
    /// @notice Refund owed for unmatched or crowded-out path segments.
    uint256 refund;
  }
}
