// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable immutable-vars-naming

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {CompleteSetBinaryMarket} from "./CompleteSetBinaryMarket.sol";
import {IPostgradAdapter} from "./IPostgradAdapter.sol";
import {MarketTypes} from "../types/MarketTypes.sol";

/// @title CompleteSetPostgradAdapter
/// @author Pop Charts
/// @notice Bridges finalized pregrad receipt claims into complete-set ERC20 postgrad markets.
contract CompleteSetPostgradAdapter is Ownable, ReentrancyGuard, IPostgradAdapter {
  using SafeERC20 for IERC20;

  uint8 private constant MAX_SUPPORTED_DECIMALS = 77;

  /// @notice Reverts when the configured pregrad manager is zero.
  error InvalidPregradManager();
  /// @notice Reverts when the configured resolver is zero.
  error InvalidResolver();
  /// @notice Reverts when the configured outcome decimals cannot be represented safely.
  /// @param outcomeDecimals Decimals value that is too large.
  error UnsupportedOutcomeDecimals(uint8 outcomeDecimals);
  /// @notice Reverts when a prepared market uses the zero collateral token.
  error InvalidCollateral();
  /// @notice Reverts when a prepared market has no metadata hash.
  error InvalidMetadataHash();
  /// @notice Reverts when retained collateral is zero.
  error InvalidRetainedCollateral();
  /// @notice Reverts when retained outcome capacity is zero.
  error InvalidCompleteSetCount();
  /// @notice Reverts when an account other than the pregrad manager calls the adapter.
  /// @param account Unauthorized caller.
  error UnauthorizedPregradManager(address account);
  /// @notice Reverts when a pregrad market is prepared more than once.
  /// @param marketId Market that was already prepared.
  error MarketAlreadyPrepared(uint256 marketId);
  /// @notice Reverts when outcome distribution is attempted before preparation.
  /// @param marketId Market that has not been prepared.
  error MarketNotPrepared(uint256 marketId);
  /// @notice Reverts when the collateral transfer delivers less or more than expected.
  /// @param expected Exact collateral amount expected.
  /// @param received Actual collateral amount observed by balance delta.
  error InvalidCollateralTransfer(uint256 expected, uint256 received);
  /// @notice Reverts when retained collateral does not map to the submitted outcome capacity.
  /// @param expected Outcome capacity committed by the finalized clearing root.
  /// @param actual Outcome capacity funded in the postgrad market.
  error OutcomeCapacityMismatch(uint256 expected, uint256 actual);

  /// @notice Prepared postgrad market metadata.
  struct PreparedMarket {
    /// @notice Complete-set postgrad market address.
    address market;
    /// @notice ERC20 collateral token backing outcome redemption.
    address collateral;
    /// @notice Hash of market metadata and resolution rules.
    bytes32 metadataHash;
    /// @notice Collateral amount retained from pregrad settlement.
    uint256 retainedCollateral;
    /// @notice Outcome-token capacity represented by retained collateral.
    uint256 completeSetCount;
    /// @notice Whether this pregrad market has been prepared.
    bool prepared;
  }

  /// @notice Emitted when a finalized pregrad market receives a postgrad market.
  /// @param marketId Pregrad market ID being prepared.
  /// @param postgradMarket Complete-set postgrad market address.
  /// @param collateral ERC20 collateral token backing outcomes.
  /// @param metadataHash Hash of market metadata and resolution rules.
  /// @param retainedCollateral Collateral amount retained from pregrad settlement.
  /// @param completeSetCount Outcome-token capacity represented by retained collateral.
  event PostgradMarketPrepared(
    uint256 indexed marketId,
    address indexed postgradMarket,
    address indexed collateral,
    bytes32 metadataHash,
    uint256 retainedCollateral,
    uint256 completeSetCount
  );

  /// @notice Emitted when a finalized receipt claim mints retained outcome tokens.
  /// @param marketId Pregrad market ID whose outcome was distributed.
  /// @param recipient Account receiving outcome tokens.
  /// @param side YES or NO outcome side.
  /// @param amount Outcome token amount distributed.
  event RetainedOutcomeDistributed(
    uint256 indexed marketId,
    address indexed recipient,
    MarketTypes.Side indexed side,
    uint256 amount
  );

  /// @notice Pregrad manager allowed to prepare markets and distribute claims.
  address public immutable pregradManager;
  /// @notice Resolver assigned to newly deployed complete-set markets.
  address public immutable resolver;
  /// @notice Outcome token decimals assigned to newly deployed complete-set markets.
  uint8 public immutable outcomeDecimals;

  mapping(uint256 marketId => PreparedMarket) private _preparedMarkets;

  /// @notice Configures the adapter for a single pregrad manager.
  /// @param pregradManager_ Manager allowed to prepare and distribute outcomes.
  /// @param owner_ Owner assigned to this adapter and deployed postgrad markets.
  /// @param resolver_ Resolver assigned to deployed postgrad markets.
  /// @param outcomeDecimals_ Outcome-token decimals for deployed postgrad markets.
  constructor(
    address pregradManager_,
    address owner_,
    address resolver_,
    uint8 outcomeDecimals_
  ) Ownable(owner_) {
    if (pregradManager_ == address(0)) {
      revert InvalidPregradManager();
    }
    if (resolver_ == address(0)) {
      revert InvalidResolver();
    }
    if (outcomeDecimals_ > MAX_SUPPORTED_DECIMALS) {
      revert UnsupportedOutcomeDecimals(outcomeDecimals_);
    }

    pregradManager = pregradManager_;
    resolver = resolver_;
    outcomeDecimals = outcomeDecimals_;
  }

  /// @inheritdoc IPostgradAdapter
  function prepareMarket(
    uint256 marketId,
    address collateral,
    bytes32 metadataHash,
    uint256 retainedCollateral,
    uint256 completeSetCount
  )
    external
    onlyPregradManager
    nonReentrant
    returns (address preparedMarketAddress, uint256 outcomeCapacity)
  {
    if (_preparedMarkets[marketId].prepared) {
      revert MarketAlreadyPrepared(marketId);
    }
    if (collateral == address(0)) {
      revert InvalidCollateral();
    }
    if (metadataHash == bytes32(0)) {
      revert InvalidMetadataHash();
    }
    if (retainedCollateral == 0) {
      revert InvalidRetainedCollateral();
    }
    if (completeSetCount == 0) {
      revert InvalidCompleteSetCount();
    }

    IERC20 collateralToken = IERC20(collateral);
    _transferRetainedCollateralIn(collateralToken, retainedCollateral);

    CompleteSetBinaryMarket market = new CompleteSetBinaryMarket({
      collateralToken_: collateral,
      owner_: owner(),
      retainedMinter_: address(this),
      resolver_: resolver,
      marketName_: _marketName(marketId),
      marketSymbol_: _marketSymbol(marketId),
      outcomeDecimals_: outcomeDecimals
    });

    preparedMarketAddress = address(market);
    collateralToken.forceApprove(preparedMarketAddress, retainedCollateral);
    outcomeCapacity = market.fundRetainedCollateral(retainedCollateral);
    collateralToken.forceApprove(preparedMarketAddress, 0);
    if (outcomeCapacity != completeSetCount) {
      revert OutcomeCapacityMismatch(completeSetCount, outcomeCapacity);
    }

    _preparedMarkets[marketId] = PreparedMarket({
      market: preparedMarketAddress,
      collateral: collateral,
      metadataHash: metadataHash,
      retainedCollateral: retainedCollateral,
      completeSetCount: completeSetCount,
      prepared: true
    });

    emit PostgradMarketPrepared(
      marketId,
      preparedMarketAddress,
      collateral,
      metadataHash,
      retainedCollateral,
      completeSetCount
    );
  }

  /// @inheritdoc IPostgradAdapter
  function distributeOutcome(
    uint256 marketId,
    address recipient,
    MarketTypes.Side side,
    uint256 amount
  ) external onlyPregradManager nonReentrant {
    PreparedMarket memory preparedMarket = _requirePreparedMarket(marketId);
    CompleteSetBinaryMarket(preparedMarket.market).mintRetainedSide(recipient, side, amount);

    emit RetainedOutcomeDistributed(marketId, recipient, side, amount);
  }

  /// @notice Returns prepared market metadata.
  /// @param marketId Pregrad market ID to read.
  /// @return Prepared market record.
  function getPreparedMarket(uint256 marketId) external view returns (PreparedMarket memory) {
    return _preparedMarkets[marketId];
  }

  /// @notice Returns the complete-set market for a pregrad market.
  /// @param marketId Pregrad market ID to read.
  /// @return Complete-set postgrad market, or zero if the market has not been prepared.
  function postgradMarket(uint256 marketId) external view returns (address) {
    return _preparedMarkets[marketId].market;
  }

  /// @notice Restricts calls to the configured pregrad manager.
  modifier onlyPregradManager() {
    if (msg.sender != pregradManager) {
      revert UnauthorizedPregradManager(msg.sender);
    }
    _;
  }

  /// @notice Transfers retained collateral from the pregrad manager and rejects transfer fees.
  /// @param collateralToken Token to transfer.
  /// @param retainedCollateral Exact collateral amount expected.
  function _transferRetainedCollateralIn(
    IERC20 collateralToken,
    uint256 retainedCollateral
  ) private {
    uint256 balanceBefore = collateralToken.balanceOf(address(this));
    collateralToken.safeTransferFrom(msg.sender, address(this), retainedCollateral);
    uint256 balanceAfter = collateralToken.balanceOf(address(this));
    uint256 received = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;

    if (received != retainedCollateral) {
      revert InvalidCollateralTransfer(retainedCollateral, received);
    }
  }

  /// @notice Requires a market to be prepared before outcome distribution.
  /// @param marketId Pregrad market ID to check.
  /// @return preparedMarket Prepared market metadata.
  function _requirePreparedMarket(
    uint256 marketId
  ) private view returns (PreparedMarket memory preparedMarket) {
    preparedMarket = _preparedMarkets[marketId];
    if (!preparedMarket.prepared) {
      revert MarketNotPrepared(marketId);
    }
  }

  /// @notice Builds a deterministic postgrad market name.
  /// @param marketId Pregrad market ID.
  /// @return Market name string.
  function _marketName(uint256 marketId) private pure returns (string memory) {
    return string.concat("Pop Charts Market ", Strings.toString(marketId));
  }

  /// @notice Builds a deterministic postgrad market symbol prefix.
  /// @param marketId Pregrad market ID.
  /// @return Market symbol prefix.
  function _marketSymbol(uint256 marketId) private pure returns (string memory) {
    return string.concat("PCM", Strings.toString(marketId));
  }
}
