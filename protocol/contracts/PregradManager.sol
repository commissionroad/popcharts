// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LmsrMath} from "./libraries/LmsrMath.sol";
import {MarketTypes} from "./types/MarketTypes.sol";

/// @title PregradManager
/// @author Pop Charts
/// @notice Singleton manager for all Pop Charts pre-graduation markets.
contract PregradManager is ReentrancyGuard {
  using SafeERC20 for IERC20;

  /// @notice Reverts when a market is created with the zero collateral address.
  error InvalidCollateral();
  /// @notice Reverts when a market is created without a metadata hash.
  error InvalidMetadataHash();
  /// @notice Reverts when the graduation deadline is not in the future.
  error InvalidGraduationTime();
  /// @notice Reverts when the resolution deadline is not after the graduation deadline.
  error InvalidResolutionTime();
  /// @notice Reverts when a market is created without a graduation threshold.
  error InvalidGraduationThreshold();
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
  /// @param graduationTime Market graduation deadline.
  error MarketPastGraduationTime(uint256 marketId, uint64 graduationTime);
  /// @notice Reverts when the per-market receipt sequence cannot fit in uint64.
  /// @param receiptCount Receipt count that would overflow the stored sequence type.
  error ReceiptCountOverflow(uint256 receiptCount);

  /// @notice Emitted when a new active market is created.
  /// @param marketId Canonical pregrad market ID.
  /// @param creator Account that created the market.
  /// @param metadataHash Hash of market metadata and resolution rules.
  /// @param collateral Collateral token accepted by the market.
  /// @param openingProbabilityWad Opening YES probability, scaled by 1e18.
  /// @param liquidityParameter Virtual LMSR smoothness parameter.
  /// @param graduationThreshold Minimum matched market cap required to graduate.
  /// @param graduationTime Timestamp by which the market must graduate or become refundable.
  /// @param resolutionTime Timestamp by which the postgrad market should resolve.
  event MarketCreated(
    uint256 indexed marketId,
    address indexed creator,
    bytes32 indexed metadataHash,
    address collateral,
    uint256 openingProbabilityWad,
    uint256 liquidityParameter,
    uint256 graduationThreshold,
    uint64 graduationTime,
    uint64 resolutionTime
  );

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

  uint256 private _nextMarketId = 1;
  uint256 private _nextReceiptId = 1;
  mapping(uint256 marketId => MarketTypes.MarketRecord) private _markets;
  mapping(uint256 receiptId => MarketTypes.Receipt) private _receipts;

  /// @notice Creates a new market in Active status.
  /// @param params Market creation parameters, excluding creator.
  /// @return marketId Canonical pregrad market ID.
  function createMarket(
    MarketTypes.CreateMarketParams calldata params
  ) external returns (uint256 marketId) {
    _validateCreateMarketParams(params);

    marketId = _nextMarketId;
    ++_nextMarketId;

    MarketTypes.MarketRecord storage market = _markets[marketId];
    market.config = MarketTypes.MarketConfig({
      collateral: params.collateral,
      creator: msg.sender,
      metadataHash: params.metadataHash,
      openingProbabilityWad: params.openingProbabilityWad,
      liquidityParameter: params.liquidityParameter,
      graduationThreshold: params.graduationThreshold,
      graduationTime: params.graduationTime,
      resolutionTime: params.resolutionTime
    });
    market.state.status = MarketTypes.MarketStatus.Active;
    market.state.path = LmsrMath.openingPath(
      params.openingProbabilityWad,
      params.liquidityParameter
    );

    emit MarketCreated(
      marketId,
      msg.sender,
      params.metadataHash,
      params.collateral,
      params.openingProbabilityWad,
      params.liquidityParameter,
      params.graduationThreshold,
      params.graduationTime,
      params.resolutionTime
    );
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
    _requireBeforeGraduationTime(marketId, market.config.graduationTime);

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
    _requireBeforeGraduationTime(params.marketId, market.config.graduationTime);

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
    if (params.collateral == address(0)) {
      revert InvalidCollateral();
    }
    if (params.metadataHash == bytes32(0)) {
      revert InvalidMetadataHash();
    }
    if (params.graduationTime <= block.timestamp) {
      revert InvalidGraduationTime();
    }
    if (params.resolutionTime <= params.graduationTime) {
      revert InvalidResolutionTime();
    }
    if (params.graduationThreshold == 0) {
      revert InvalidGraduationThreshold();
    }

    LmsrMath.validateOpeningProbability(params.openingProbabilityWad);
    LmsrMath.validateLiquidityParameter(params.liquidityParameter);
  }

  /// @notice Transfers receipt collateral and rejects tokens whose received amount differs from cost.
  /// @param collateral ERC20 collateral token.
  /// @param from Account paying the receipt cost.
  /// @param cost Exact collateral amount expected in escrow.
  function _transferEscrow(IERC20 collateral, address from, uint256 cost) private {
    uint256 balanceBefore = collateral.balanceOf(address(this));
    collateral.safeTransferFrom(from, address(this), cost);
    uint256 balanceAfter = collateral.balanceOf(address(this));
    uint256 received = balanceAfter > balanceBefore ? balanceAfter - balanceBefore : 0;

    if (received != cost) {
      revert InvalidCollateralTransfer(cost, received);
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

  /// @notice Requires the current block timestamp to be before the market graduation deadline.
  /// @param marketId Market ID being guarded.
  /// @param graduationTime Market graduation deadline.
  function _requireBeforeGraduationTime(uint256 marketId, uint64 graduationTime) private view {
    if (block.timestamp >= graduationTime) {
      revert MarketPastGraduationTime(marketId, graduationTime);
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
}
