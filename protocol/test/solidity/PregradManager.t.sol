// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {MockCollateral} from "../../contracts/mocks/MockCollateral.sol";
import {MockFeeCollateral} from "../../contracts/mocks/MockFeeCollateral.sol";
import {PregradManager} from "../../contracts/PregradManager.sol";
import {LmsrMath} from "../../contracts/libraries/LmsrMath.sol";
import {CompleteSetBinaryMarket} from "../../contracts/postgrad/CompleteSetBinaryMarket.sol";
import {CompleteSetPostgradAdapter} from "../../contracts/postgrad/CompleteSetPostgradAdapter.sol";
import {OutcomeToken} from "../../contracts/postgrad/OutcomeToken.sol";
import {MarketTypes} from "../../contracts/types/MarketTypes.sol";

contract PregradManagerTest is Test {
  uint256 private constant WAD = 1e18;

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
    bool bypassAiResolution
  );

  event MarketReviewApproved(uint256 indexed marketId, address indexed reviewer);

  event MarketReviewRejected(uint256 indexed marketId, address indexed reviewer);

  event TrustedCreatorUpdated(address indexed account, bool trusted);

  event MarketCreationPausedUpdated(bool paused);

  event MarketCreationFeePaid(uint256 indexed marketId, address indexed creator, uint256 amount);

  event CreationFeesWithdrawn(address indexed recipient, uint256 amount);

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

  event MarketRefundsAvailable(uint256 indexed marketId, uint256 totalEscrowed);

  event GraduationFinalized(
    uint256 indexed marketId,
    address indexed postgradAdapter,
    address indexed postgradMarket,
    uint256 completeSetCount,
    uint256 retainedCostTotal,
    uint256 refundTotal
  );

  event GraduatedReceiptClaimed(
    uint256 indexed receiptId,
    uint256 indexed marketId,
    address indexed owner,
    MarketTypes.Side side,
    uint256 retainedShares,
    uint256 retainedCost,
    uint256 refund
  );

  event RefundedReceiptClaimed(
    uint256 indexed receiptId,
    uint256 indexed marketId,
    address indexed owner,
    uint256 refund
  );

  struct SubmittedClearingFixture {
    uint256 marketId;
    uint256 receiptId;
    address buyer;
    MarketTypes.ReceiptQuote quote;
    MarketTypes.ReceiptClaim claim;
    uint256 matchedMarketCap;
    uint256 refundTotal;
    uint64 challengeDeadline;
  }

  MockCollateral private collateral;
  PregradManager private manager;

  function setUp() public {
    collateral = new MockCollateral();
    manager = new PregradManager();
    manager.setTrustedCreator(address(this), true);
  }

  function test_CreateMarketStoresUnderReviewConfigAndEmitsEvent() public {
    bytes32 metadataHash = _defaultMetadataHash();
    MarketTypes.CreateMarketParams memory params = _defaultMarketParams(metadataHash);

    vm.expectEmit(true, true, true, true, address(manager));
    emit MarketCreated(
      1,
      address(this),
      metadataHash,
      params.metadata,
      address(collateral),
      params.openingProbabilityWad,
      params.liquidityParameter,
      params.graduationThreshold,
      params.graduationDeadline,
      params.resolutionTime,
      params.bypassAiResolution
    );

    uint256 marketId = manager.createMarket(params);

    MarketTypes.MarketConfig memory config = manager.getMarketConfig(marketId);
    MarketTypes.MarketState memory state = manager.getMarketState(marketId);

    assertEq(marketId, 1);
    assertEq(manager.nextMarketId(), 2);
    assertEq(manager.marketCount(), 1);
    assertTrue(manager.marketExists(marketId));
    assertEq(config.collateral, address(collateral));
    assertEq(config.creator, address(this));
    assertEq(config.metadataHash, metadataHash);
    assertEq(config.openingProbabilityWad, (50 * WAD) / 100);
    assertEq(config.liquidityParameter, 5_000 * WAD);
    assertEq(config.graduationThreshold, 2_500 * WAD);
    assertEq(config.graduationDeadline, params.graduationDeadline);
    assertEq(config.resolutionTime, params.resolutionTime);
    assertEq(uint256(state.status), uint256(MarketTypes.MarketStatus.UnderReview));
    assertFalse(config.bypassAiResolution);
    assertEq(uint256(state.status), uint256(MarketTypes.MarketStatus.UnderReview));
    assertEq(state.receiptCount, 0);
    assertEq(state.totalEscrowed, 0);
    assertEq(state.path, int256(0));
    assertEq(state.yesShares, 0);
    assertEq(state.noShares, 0);
    assertEq(state.graduationStartedAt, 0);
  }

  function test_OwnerCanPauseAndResumeMarketCreation() public {
    bytes32 metadataHash = _defaultMetadataHash();
    MarketTypes.CreateMarketParams memory params = _defaultMarketParams(metadataHash);

    vm.expectEmit(true, true, true, true, address(manager));
    emit MarketCreationPausedUpdated(true);
    manager.setMarketCreationPaused(true);

    assertTrue(manager.marketCreationPaused());

    vm.expectRevert(PregradManager.MarketCreationPaused.selector);
    manager.createMarket(params);

    assertEq(manager.nextMarketId(), 1);
    assertEq(manager.marketCount(), 0);

    vm.expectEmit(true, true, true, true, address(manager));
    emit MarketCreationPausedUpdated(false);
    manager.setMarketCreationPaused(false);

    assertFalse(manager.marketCreationPaused());
    assertEq(manager.createMarket(params), 1);
    assertEq(manager.nextMarketId(), 2);
    assertEq(manager.marketCount(), 1);
  }

  function test_ReviewManagersApproveAndRejectUnderReviewMarkets() public {
    address notManager = makeAddr("not-reviewer");
    uint256 approvedMarketId = manager.createMarket(_defaultMarketParams(_defaultMetadataHash()));

    assertTrue(manager.isReviewManager(address(this)));
    assertFalse(manager.isReviewManager(notManager));

    vm.prank(notManager);
    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.UnauthorizedReviewManager.selector, notManager)
    );
    manager.approveMarket(approvedMarketId);

    vm.expectEmit(true, true, true, true, address(manager));
    emit MarketReviewApproved(approvedMarketId, address(this));
    manager.approveMarket(approvedMarketId);

    MarketTypes.MarketState memory approvedState = manager.getMarketState(approvedMarketId);
    assertEq(uint256(approvedState.status), uint256(MarketTypes.MarketStatus.Active));

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidMarketStatus.selector,
        approvedMarketId,
        MarketTypes.MarketStatus.Active,
        MarketTypes.MarketStatus.UnderReview
      )
    );
    manager.rejectMarket(approvedMarketId);

    uint256 rejectedMarketId = manager.createMarket(_defaultMarketParams(_defaultMetadataHash()));

    vm.expectEmit(true, true, true, true, address(manager));
    emit MarketReviewRejected(rejectedMarketId, address(this));
    manager.rejectMarket(rejectedMarketId);

    MarketTypes.MarketState memory rejectedState = manager.getMarketState(rejectedMarketId);
    assertEq(uint256(rejectedState.status), uint256(MarketTypes.MarketStatus.Rejected));

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidMarketStatus.selector,
        rejectedMarketId,
        MarketTypes.MarketStatus.Rejected,
        MarketTypes.MarketStatus.UnderReview
      )
    );
    manager.approveMarket(rejectedMarketId);
  }

  function test_ApproveMarketRequiresDeadline() public {
    uint256 marketId = manager.createMarket(_defaultMarketParams(_defaultMetadataHash()));
    MarketTypes.MarketConfig memory config = manager.getMarketConfig(marketId);

    vm.warp(config.graduationDeadline);

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.MarketPastGraduationDeadline.selector,
        marketId,
        config.graduationDeadline
      )
    );
    manager.approveMarket(marketId);
  }

  function test_UnderReviewAndRejectedMarketsDoNotAcceptReceipts() public {
    address buyer = makeAddr("buyer");
    uint256 marketId = manager.createMarket(_defaultMarketParams(_defaultMetadataHash()));
    uint256 shares = 100 * WAD;
    MarketTypes.PlaceReceiptParams memory params = MarketTypes.PlaceReceiptParams({
      marketId: marketId,
      side: MarketTypes.Side.Yes,
      shares: shares,
      maxCost: type(uint256).max
    });

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidMarketStatus.selector,
        marketId,
        MarketTypes.MarketStatus.UnderReview,
        MarketTypes.MarketStatus.Active
      )
    );
    manager.quoteReceipt(marketId, MarketTypes.Side.Yes, shares);

    vm.prank(buyer);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidMarketStatus.selector,
        marketId,
        MarketTypes.MarketStatus.UnderReview,
        MarketTypes.MarketStatus.Active
      )
    );
    manager.placeReceipt(params);

    manager.rejectMarket(marketId);

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidMarketStatus.selector,
        marketId,
        MarketTypes.MarketStatus.Rejected,
        MarketTypes.MarketStatus.Active
      )
    );
    manager.quoteReceipt(marketId, MarketTypes.Side.Yes, shares);

    vm.prank(buyer);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidMarketStatus.selector,
        marketId,
        MarketTypes.MarketStatus.Rejected,
        MarketTypes.MarketStatus.Active
      )
    );
    manager.placeReceipt(params);
  }

  function test_CreateMarketIdsIncrementAndMarketsAreIsolated() public {
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bytes32 aliceMetadataHash = _defaultMetadataHash();
    bytes32 bobMetadataHash = _defaultMetadataHash();

    vm.deal(alice, 10 * WAD);
    vm.deal(bob, 10 * WAD);

    vm.prank(alice);
    uint256 aliceMarketId = manager.createMarket{value: WAD}(
      MarketTypes.CreateMarketParams({
        collateral: address(collateral),
        metadataHash: aliceMetadataHash,
        metadata: _defaultMetadata(),
        openingProbabilityWad: (20 * WAD) / 100,
        liquidityParameter: 2_500 * WAD,
        graduationThreshold: 1_250 * WAD,
        graduationDeadline: uint64(block.timestamp + 3 days),
        resolutionTime: uint64(block.timestamp + 30 days),
        bypassAiResolution: false
      })
    );

    vm.prank(bob);
    uint256 bobMarketId = manager.createMarket{value: WAD}(
      MarketTypes.CreateMarketParams({
        collateral: address(collateral),
        metadataHash: bobMetadataHash,
        metadata: _defaultMetadata(),
        openingProbabilityWad: (80 * WAD) / 100,
        liquidityParameter: 8_000 * WAD,
        graduationThreshold: 4_000 * WAD,
        graduationDeadline: uint64(block.timestamp + 14 days),
        resolutionTime: uint64(block.timestamp + 60 days),
        bypassAiResolution: false
      })
    );

    MarketTypes.MarketConfig memory aliceConfig = manager.getMarketConfig(aliceMarketId);
    MarketTypes.MarketConfig memory bobConfig = manager.getMarketConfig(bobMarketId);

    assertEq(aliceMarketId, 1);
    assertEq(bobMarketId, 2);
    assertEq(manager.marketCount(), 2);
    assertEq(aliceConfig.creator, alice);
    assertEq(bobConfig.creator, bob);
    assertEq(aliceConfig.metadataHash, aliceMetadataHash);
    assertEq(bobConfig.metadataHash, bobMetadataHash);
    assertEq(aliceConfig.openingProbabilityWad, (20 * WAD) / 100);
    assertEq(bobConfig.openingProbabilityWad, (80 * WAD) / 100);
  }

  function test_PublicCreatorsPayCreationFeeAndOwnerCanWithdrawIt() public {
    address publicCreator = makeAddr("public-creator");
    address feeRecipient = makeAddr("fee-recipient");
    bytes32 metadataHash = _defaultMetadataHash();
    MarketTypes.CreateMarketParams memory params = _defaultMarketParams(metadataHash);

    vm.deal(publicCreator, 10 * WAD);

    assertEq(manager.MARKET_CREATION_FEE(), WAD);
    assertEq(manager.marketCreationFee(publicCreator), WAD);
    assertEq(manager.collectedCreationFees(), 0);

    vm.expectEmit(true, true, true, true, address(manager));
    emit MarketCreated(
      1,
      publicCreator,
      metadataHash,
      params.metadata,
      address(collateral),
      params.openingProbabilityWad,
      params.liquidityParameter,
      params.graduationThreshold,
      params.graduationDeadline,
      params.resolutionTime,
      params.bypassAiResolution
    );
    vm.expectEmit(true, true, true, true, address(manager));
    emit MarketCreationFeePaid(1, publicCreator, WAD);

    vm.prank(publicCreator);
    uint256 marketId = manager.createMarket{value: WAD}(params);

    assertEq(marketId, 1);
    assertEq(manager.collectedCreationFees(), WAD);
    assertEq(address(manager).balance, WAD);
    assertEq(publicCreator.balance, 9 * WAD);

    vm.prank(publicCreator);
    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.InvalidMarketCreationFee.selector, WAD, 0)
    );
    manager.createMarket(_defaultMarketParams(_defaultMetadataHash()));

    vm.prank(publicCreator);
    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.InvalidMarketCreationFee.selector, WAD, WAD + 1)
    );
    manager.createMarket{value: WAD + 1}(_defaultMarketParams(_defaultMetadataHash()));

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.CreationFeeWithdrawalExceedsBalance.selector,
        WAD,
        WAD + 1
      )
    );
    manager.withdrawCreationFees(payable(feeRecipient), WAD + 1);

    vm.expectRevert(PregradManager.InvalidCreationFeeRecipient.selector);
    manager.withdrawCreationFees(payable(address(0)), WAD);

    vm.expectEmit(true, true, true, true, address(manager));
    emit CreationFeesWithdrawn(feeRecipient, WAD);
    manager.withdrawCreationFees(payable(feeRecipient), WAD);

    assertEq(manager.collectedCreationFees(), 0);
    assertEq(address(manager).balance, 0);
    assertEq(feeRecipient.balance, WAD);
  }

  function test_PlaceReceiptEmitsEventAndEscrowsCollateral() public {
    address buyer = makeAddr("buyer");
    uint256 marketId = _createDefaultMarket();
    uint256 shares = 100 * WAD;

    _fundAndApprove(buyer, 1_000 * WAD);
    MarketTypes.ReceiptQuote memory quote = manager.quoteReceipt(
      marketId,
      MarketTypes.Side.Yes,
      shares
    );

    assertGt(quote.cost, 50 * WAD);
    assertLt(quote.cost, 51 * WAD);
    assertEq(quote.rLow, int256(0));
    assertEq(quote.rHigh, int256(shares));

    vm.expectEmit(true, true, true, true, address(manager));
    emit ReceiptPlaced(
      1,
      marketId,
      buyer,
      MarketTypes.Side.Yes,
      shares,
      quote.cost,
      quote.rLow,
      quote.rHigh,
      1
    );

    vm.prank(buyer);
    uint256 receiptId = manager.placeReceipt(
      MarketTypes.PlaceReceiptParams({
        marketId: marketId,
        side: MarketTypes.Side.Yes,
        shares: shares,
        maxCost: quote.cost
      })
    );

    MarketTypes.MarketState memory state = manager.getMarketState(marketId);

    assertEq(receiptId, 1);
    assertEq(manager.totalReceiptCount(), 1);
    assertEq(state.totalEscrowed, quote.cost);
    assertEq(collateral.balanceOf(address(manager)), quote.cost);
    assertEq(collateral.balanceOf(buyer), 1_000 * WAD - quote.cost);
  }

  function test_PlaceReceiptStoresReceiptAndUpdatesMarketState() public {
    address buyer = makeAddr("buyer");
    uint256 marketId = _createDefaultMarket();
    uint256 shares = 100 * WAD;

    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, MarketTypes.ReceiptQuote memory quote) = _placeReceiptAs(
      buyer,
      marketId,
      MarketTypes.Side.Yes,
      shares
    );

    MarketTypes.Receipt memory receipt = manager.getReceipt(receiptId);
    MarketTypes.MarketState memory state = manager.getMarketState(marketId);

    assertEq(manager.nextReceiptId(), 2);
    assertTrue(manager.receiptExists(receiptId));
    assertEq(receipt.marketId, marketId);
    assertEq(receipt.owner, buyer);
    assertEq(uint256(receipt.side), uint256(MarketTypes.Side.Yes));
    assertEq(receipt.shares, shares);
    assertEq(receipt.cost, quote.cost);
    assertEq(receipt.rLow, quote.rLow);
    assertEq(receipt.rHigh, quote.rHigh);
    assertEq(receipt.sequence, 1);
    assertTrue(receipt.active);
    assertEq(state.receiptCount, 1);
    assertEq(state.totalEscrowed, quote.cost);
    assertEq(state.path, quote.rHigh);
    assertEq(state.yesShares, shares);
    assertEq(state.noShares, 0);
  }

  function test_PlaceReceiptIdsIncrementAndMarketsAreIsolated() public {
    address buyer = makeAddr("buyer");
    uint256 firstMarketId = _createDefaultMarket();
    uint256 secondMarketId = _createSecondDefaultMarket();

    uint256 firstShares = 50 * WAD;
    uint256 secondShares = 25 * WAD;
    _fundAndApprove(buyer, 1_000 * WAD);

    (uint256 firstReceiptId, MarketTypes.ReceiptQuote memory firstQuote) = _placeReceiptAs(
      buyer,
      firstMarketId,
      MarketTypes.Side.Yes,
      firstShares
    );
    (uint256 secondReceiptId, MarketTypes.ReceiptQuote memory secondQuote) = _placeReceiptAs(
      buyer,
      secondMarketId,
      MarketTypes.Side.No,
      secondShares
    );

    MarketTypes.Receipt memory firstReceipt = manager.getReceipt(firstReceiptId);
    MarketTypes.Receipt memory secondReceipt = manager.getReceipt(secondReceiptId);
    MarketTypes.MarketState memory firstState = manager.getMarketState(firstMarketId);
    MarketTypes.MarketState memory secondState = manager.getMarketState(secondMarketId);

    assertEq(firstReceiptId, 1);
    assertEq(secondReceiptId, 2);
    assertEq(firstReceipt.sequence, 1);
    assertEq(secondReceipt.sequence, 1);
    assertEq(firstState.receiptCount, 1);
    assertEq(secondState.receiptCount, 1);
    assertEq(firstState.totalEscrowed, firstQuote.cost);
    assertEq(secondState.totalEscrowed, secondQuote.cost);
    assertEq(firstState.path, firstQuote.rHigh);
    assertEq(secondState.path, secondQuote.rLow);
    assertEq(firstState.yesShares, firstShares);
    assertEq(firstState.noShares, 0);
    assertEq(secondState.yesShares, 0);
    assertEq(secondState.noShares, secondShares);
    assertEq(collateral.balanceOf(address(manager)), firstQuote.cost + secondQuote.cost);
  }

  function test_RevertsForUnknownMarket() public {
    vm.expectRevert(abi.encodeWithSelector(PregradManager.MarketDoesNotExist.selector, 1));
    manager.getMarketConfig(1);

    vm.expectRevert(abi.encodeWithSelector(PregradManager.ReceiptDoesNotExist.selector, 1));
    manager.getReceipt(1);
  }

  function test_RevertsForInvalidMarketConfig() public {
    MarketTypes.CreateMarketParams memory params = MarketTypes.CreateMarketParams({
      collateral: address(0),
      metadataHash: _defaultMetadataHash(),
      metadata: _defaultMetadata(),
      openingProbabilityWad: (50 * WAD) / 100,
      liquidityParameter: 5_000 * WAD,
      graduationThreshold: 2_500 * WAD,
      graduationDeadline: uint64(block.timestamp + 7 days),
      resolutionTime: uint64(block.timestamp + 14 days),
      bypassAiResolution: false
    });

    vm.expectRevert(PregradManager.InvalidCollateral.selector);
    manager.createMarket(params);

    params.collateral = address(collateral);
    params.metadataHash = bytes32(0);
    vm.expectRevert(PregradManager.InvalidMetadataHash.selector);
    manager.createMarket(params);

    params.metadataHash = _defaultMetadataHash();
    params.metadata = "";
    vm.expectRevert(PregradManager.InvalidMetadata.selector);
    manager.createMarket(params);

    params.metadata = "not matching the committed hash";
    vm.expectRevert(PregradManager.InvalidMetadataHash.selector);
    manager.createMarket(params);

    params.metadata = _longMetadata();
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.MetadataTooLong.selector,
        bytes(params.metadata).length,
        manager.MAX_METADATA_BYTES()
      )
    );
    manager.createMarket(params);

    params.metadata = _defaultMetadata();
    params.openingProbabilityWad = 0;
    vm.expectRevert(abi.encodeWithSelector(LmsrMath.InvalidProbability.selector, 0));
    manager.createMarket(params);

    params.openingProbabilityWad = WAD;
    vm.expectRevert(abi.encodeWithSelector(LmsrMath.InvalidProbability.selector, WAD));
    manager.createMarket(params);

    params.openingProbabilityWad = (50 * WAD) / 100;
    params.liquidityParameter = 0;
    vm.expectRevert(LmsrMath.InvalidLiquidityParameter.selector);
    manager.createMarket(params);

    params.liquidityParameter = 5_000 * WAD;
    params.graduationThreshold = 0;
    vm.expectRevert(PregradManager.InvalidGraduationThreshold.selector);
    manager.createMarket(params);

    params.graduationThreshold = 2_500 * WAD;
    params.graduationDeadline = uint64(block.timestamp);
    vm.expectRevert(PregradManager.InvalidGraduationDeadline.selector);
    manager.createMarket(params);

    params.graduationDeadline = uint64(block.timestamp + 7 days);
    params.resolutionTime = params.graduationDeadline;
    vm.expectRevert(PregradManager.InvalidResolutionTime.selector);
    manager.createMarket(params);

    params.resolutionTime = uint64(block.timestamp);
    vm.expectRevert(PregradManager.InvalidResolutionTime.selector);
    manager.createMarket(params);
  }

  function test_RevertsWhenPublicMarketLeavesCreationEnvelope() public {
    address publicCreator = makeAddr("public-envelope-creator");
    MarketTypes.CreateMarketParams memory params = _defaultMarketParams(_defaultMetadataHash());
    _fundAndApprove(publicCreator, 10 * WAD);

    params.openingProbabilityWad = (1 * WAD) / 100;
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.PublicOpeningProbabilityOutOfBounds.selector,
        params.openingProbabilityWad
      )
    );
    vm.prank(publicCreator);
    manager.createMarket(params);

    params.openingProbabilityWad = (99 * WAD) / 100;
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.PublicOpeningProbabilityOutOfBounds.selector,
        params.openingProbabilityWad
      )
    );
    vm.prank(publicCreator);
    manager.createMarket(params);

    params.openingProbabilityWad = (50 * WAD) / 100;
    params.liquidityParameter = 499 * WAD;
    params.graduationThreshold = params.liquidityParameter / 2;
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.PublicLiquidityParameterOutOfBounds.selector,
        params.liquidityParameter
      )
    );
    vm.prank(publicCreator);
    manager.createMarket(params);

    params.liquidityParameter = 10_001 * WAD;
    params.graduationThreshold = params.liquidityParameter / 2;
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.PublicLiquidityParameterOutOfBounds.selector,
        params.liquidityParameter
      )
    );
    vm.prank(publicCreator);
    manager.createMarket(params);

    params.liquidityParameter = 5_000 * WAD;
    params.graduationThreshold = 2_501 * WAD;
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.PublicGraduationThresholdMismatch.selector,
        params.graduationThreshold,
        2_500 * WAD
      )
    );
    vm.prank(publicCreator);
    manager.createMarket(params);
  }

  function test_TrustedCreatorsCanBypassPublicEnvelopeAndAiResolution() public {
    address partner = makeAddr("partner");
    MarketTypes.CreateMarketParams memory params = _defaultMarketParams(_defaultMetadataHash());
    params.openingProbabilityWad = (1 * WAD) / 100;
    params.liquidityParameter = 50 * WAD;
    params.graduationThreshold = 1 * WAD;
    params.bypassAiResolution = true;

    vm.expectEmit(true, true, true, true, address(manager));
    emit TrustedCreatorUpdated(partner, true);
    manager.setTrustedCreator(partner, true);

    assertTrue(manager.isTrustedCreator(partner));
    assertEq(manager.marketCreationFee(partner), 0);

    vm.prank(partner);
    uint256 marketId = manager.createMarket(params);

    MarketTypes.MarketConfig memory config = manager.getMarketConfig(marketId);
    assertEq(config.creator, partner);
    assertEq(config.openingProbabilityWad, (1 * WAD) / 100);
    assertEq(config.liquidityParameter, 50 * WAD);
    assertEq(config.graduationThreshold, 1 * WAD);
    assertTrue(config.bypassAiResolution);

    manager.setTrustedCreator(partner, false);
    assertFalse(manager.isTrustedCreator(partner));
    assertEq(manager.marketCreationFee(partner), WAD);

    vm.deal(partner, WAD);
    manager.setTrustedCreator(partner, true);
    vm.prank(partner);
    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.InvalidMarketCreationFee.selector, 0, WAD)
    );
    manager.createMarket{value: WAD}(_defaultMarketParams(_defaultMetadataHash()));
  }

  function test_RevertsWhenPublicCreatorBypassesAiResolution() public {
    address publicCreator = makeAddr("public-ai-bypass");
    MarketTypes.CreateMarketParams memory params = _defaultMarketParams(_defaultMetadataHash());
    params.bypassAiResolution = true;

    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.UnauthorizedAiResolutionBypass.selector, publicCreator)
    );
    vm.prank(publicCreator);
    manager.createMarket(params);
  }

  function test_RevertsWhenTrustedCreatorIsZeroAddress() public {
    vm.expectRevert(PregradManager.InvalidTrustedCreator.selector);
    manager.setTrustedCreator(address(0), true);
  }

  function test_RevertsForInvalidReceiptPlacement() public {
    address buyer = makeAddr("buyer");
    uint256 marketId = _createDefaultMarket();
    uint256 shares = 100 * WAD;
    MarketTypes.PlaceReceiptParams memory params = MarketTypes.PlaceReceiptParams({
      marketId: 999,
      side: MarketTypes.Side.Yes,
      shares: shares,
      maxCost: type(uint256).max
    });

    vm.expectRevert(abi.encodeWithSelector(PregradManager.MarketDoesNotExist.selector, 999));
    manager.placeReceipt(params);

    params.marketId = marketId;
    params.shares = 0;
    vm.expectRevert(PregradManager.InvalidShares.selector);
    manager.placeReceipt(params);

    vm.expectRevert(PregradManager.InvalidShares.selector);
    manager.quoteReceipt(marketId, MarketTypes.Side.Yes, 0);

    params.shares = shares;
    MarketTypes.ReceiptQuote memory quote = manager.quoteReceipt(
      marketId,
      MarketTypes.Side.Yes,
      shares
    );
    params.maxCost = quote.cost - 1;
    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.CostExceedsLimit.selector, quote.cost, quote.cost - 1)
    );
    manager.placeReceipt(params);

    collateral.mint(buyer, 1_000 * WAD);
    vm.prank(buyer);
    collateral.approve(address(manager), type(uint256).max);

    MarketTypes.MarketConfig memory config = manager.getMarketConfig(marketId);
    vm.warp(config.graduationDeadline);
    params.maxCost = quote.cost;
    vm.prank(buyer);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.MarketPastGraduationDeadline.selector,
        marketId,
        config.graduationDeadline
      )
    );
    manager.placeReceipt(params);
  }

  function test_RevertsWhenCollateralTransferDoesNotMatchReceiptCost() public {
    address buyer = makeAddr("buyer");
    MockFeeCollateral feeCollateral = new MockFeeCollateral();
    uint256 marketId = manager.createMarket(
      MarketTypes.CreateMarketParams({
        collateral: address(feeCollateral),
        metadataHash: _defaultMetadataHash(),
        metadata: _defaultMetadata(),
        openingProbabilityWad: (50 * WAD) / 100,
        liquidityParameter: 5_000 * WAD,
        graduationThreshold: 2_500 * WAD,
        graduationDeadline: uint64(block.timestamp + 7 days),
        resolutionTime: uint64(block.timestamp + 14 days),
        bypassAiResolution: false
      })
    );
    manager.approveMarket(marketId);

    uint256 shares = 100 * WAD;
    MarketTypes.ReceiptQuote memory quote = manager.quoteReceipt(
      marketId,
      MarketTypes.Side.Yes,
      shares
    );
    uint256 received = quote.cost - ((quote.cost * 100) / 10_000);

    feeCollateral.mint(buyer, 1_000 * WAD);
    vm.prank(buyer);
    feeCollateral.approve(address(manager), type(uint256).max);

    vm.prank(buyer);
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidCollateralTransfer.selector,
        quote.cost,
        received
      )
    );
    manager.placeReceipt(
      MarketTypes.PlaceReceiptParams({
        marketId: marketId,
        side: MarketTypes.Side.Yes,
        shares: shares,
        maxCost: quote.cost
      })
    );
  }

  function test_StartGraduationLocksReceiptBookForOffchainClearing() public {
    address buyer = makeAddr("buyer");
    uint256 marketId = _createGraduatableMarket();
    uint256 shares = 100 * WAD;

    _fundAndApprove(buyer, 1_000 * WAD);
    (, MarketTypes.ReceiptQuote memory quote) = _placeReceiptAs(
      buyer,
      marketId,
      MarketTypes.Side.Yes,
      shares
    );

    uint64 startedAt = uint64(block.timestamp + 1 days);
    vm.warp(startedAt);

    bytes32 expectedSnapshotHash = _expectedSnapshotHash(
      marketId,
      1,
      quote.cost,
      quote.rHigh,
      shares,
      0,
      startedAt
    );

    vm.expectEmit(true, true, true, true, address(manager));
    emit GraduationStarted(
      marketId,
      address(this),
      1,
      quote.cost,
      quote.rHigh,
      shares,
      0,
      startedAt,
      expectedSnapshotHash
    );

    bytes32 snapshotHash = manager.startGraduation(marketId);
    MarketTypes.MarketState memory state = manager.getMarketState(marketId);

    assertEq(snapshotHash, expectedSnapshotHash);
    assertEq(manager.graduationSnapshotHash(marketId), expectedSnapshotHash);
    assertEq(uint256(state.status), uint256(MarketTypes.MarketStatus.Graduating));
    assertEq(state.receiptCount, 1);
    assertEq(state.totalEscrowed, quote.cost);
    assertEq(state.path, quote.rHigh);
    assertEq(state.yesShares, shares);
    assertEq(state.noShares, 0);
    assertEq(state.graduationStartedAt, startedAt);

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidMarketStatus.selector,
        marketId,
        MarketTypes.MarketStatus.Graduating,
        MarketTypes.MarketStatus.Active
      )
    );
    manager.quoteReceipt(marketId, MarketTypes.Side.Yes, shares);
  }

  function test_StartGraduationRequiresOwnerAndActiveMarketBeforeDeadline() public {
    address notManager = makeAddr("not-manager");
    uint256 marketId = _createDefaultMarket();

    vm.prank(notManager);
    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.UnauthorizedGraduationManager.selector, notManager)
    );
    manager.startGraduation(marketId);

    MarketTypes.MarketConfig memory config = manager.getMarketConfig(marketId);
    vm.warp(config.graduationDeadline);

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.MarketPastGraduationDeadline.selector,
        marketId,
        config.graduationDeadline
      )
    );
    manager.startGraduation(marketId);
  }

  function test_MarkRefundableAfterDeadline() public {
    uint256 marketId = _createDefaultMarket();
    MarketTypes.MarketConfig memory config = manager.getMarketConfig(marketId);

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.MarketBeforeGraduationDeadline.selector,
        marketId,
        config.graduationDeadline
      )
    );
    manager.markRefundable(marketId);

    vm.warp(config.graduationDeadline);

    vm.expectEmit(true, true, true, true, address(manager));
    emit MarketRefundsAvailable(marketId, 0);

    manager.markRefundable(marketId);

    MarketTypes.MarketState memory state = manager.getMarketState(marketId);
    assertEq(uint256(state.status), uint256(MarketTypes.MarketStatus.Refunded));
  }

  function test_SubmitClearingRootStoresOptimisticCommitment() public {
    address buyer = makeAddr("buyer");
    uint256 marketId = _createGraduatableMarket();
    uint256 shares = 100 * WAD;

    _fundAndApprove(buyer, 1_000 * WAD);
    (, MarketTypes.ReceiptQuote memory quote) = _placeReceiptAs(
      buyer,
      marketId,
      MarketTypes.Side.Yes,
      shares
    );

    uint64 startedAt = uint64(block.timestamp + 1 days);
    vm.warp(startedAt);
    bytes32 snapshotHash = manager.startGraduation(marketId);

    bytes32 merkleRoot = keccak256("clearing-root");
    uint256 matchedMarketCap = 50 * WAD;
    uint256 refundTotal = quote.cost - matchedMarketCap;
    uint64 submittedAt = uint64(block.timestamp + 1 hours);
    uint64 challengeDeadline = submittedAt + manager.CLEARING_CHALLENGE_PERIOD();
    vm.warp(submittedAt);

    vm.expectEmit(true, true, true, true, address(manager));
    emit ClearingRootSubmitted(
      marketId,
      address(this),
      merkleRoot,
      snapshotHash,
      matchedMarketCap,
      matchedMarketCap,
      refundTotal,
      matchedMarketCap,
      submittedAt,
      challengeDeadline
    );

    bytes32 submittedSnapshotHash = manager.submitClearingRoot(
      MarketTypes.SubmitClearingRootParams({
        marketId: marketId,
        merkleRoot: merkleRoot,
        matchedMarketCap: matchedMarketCap,
        retainedCostTotal: matchedMarketCap,
        refundTotal: refundTotal,
        completeSetCount: matchedMarketCap
      })
    );

    MarketTypes.ClearingRoot memory clearingRoot = manager.getClearingRoot(marketId);

    assertEq(submittedSnapshotHash, snapshotHash);
    assertTrue(manager.hasClearingRoot(marketId));
    assertEq(clearingRoot.merkleRoot, merkleRoot);
    assertEq(clearingRoot.submitter, address(this));
    assertEq(clearingRoot.snapshotHash, snapshotHash);
    assertEq(clearingRoot.submittedAt, submittedAt);
    assertEq(clearingRoot.challengeDeadline, challengeDeadline);
    assertEq(clearingRoot.matchedMarketCap, matchedMarketCap);
    assertEq(clearingRoot.retainedCostTotal, matchedMarketCap);
    assertEq(clearingRoot.refundTotal, refundTotal);
    assertEq(clearingRoot.completeSetCount, matchedMarketCap);
  }

  function test_SubmitClearingRootRejectsInvalidCommitments() public {
    uint256 marketId = _createGraduatingMarketWithReceipt();
    MarketTypes.MarketState memory state = manager.getMarketState(marketId);
    bytes32 merkleRoot = keccak256("clearing-root");
    uint256 matchedMarketCap = 50 * WAD;

    vm.expectRevert(PregradManager.InvalidClearingRoot.selector);
    manager.submitClearingRoot(
      MarketTypes.SubmitClearingRootParams({
        marketId: marketId,
        merkleRoot: bytes32(0),
        matchedMarketCap: matchedMarketCap,
        retainedCostTotal: matchedMarketCap,
        refundTotal: state.totalEscrowed - matchedMarketCap,
        completeSetCount: matchedMarketCap
      })
    );

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.MatchedMarketCapBelowThreshold.selector,
        49 * WAD,
        50 * WAD
      )
    );
    manager.submitClearingRoot(
      MarketTypes.SubmitClearingRootParams({
        marketId: marketId,
        merkleRoot: merkleRoot,
        matchedMarketCap: 49 * WAD,
        retainedCostTotal: 49 * WAD,
        refundTotal: state.totalEscrowed - 49 * WAD,
        completeSetCount: 49 * WAD
      })
    );

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidClearingTotals.selector,
        matchedMarketCap,
        1,
        state.totalEscrowed
      )
    );
    manager.submitClearingRoot(
      MarketTypes.SubmitClearingRootParams({
        marketId: marketId,
        merkleRoot: merkleRoot,
        matchedMarketCap: matchedMarketCap,
        retainedCostTotal: matchedMarketCap,
        refundTotal: 1,
        completeSetCount: matchedMarketCap
      })
    );

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidCompleteSetCount.selector,
        matchedMarketCap,
        matchedMarketCap - 1,
        matchedMarketCap
      )
    );
    manager.submitClearingRoot(
      MarketTypes.SubmitClearingRootParams({
        marketId: marketId,
        merkleRoot: merkleRoot,
        matchedMarketCap: matchedMarketCap,
        retainedCostTotal: matchedMarketCap - 1,
        refundTotal: state.totalEscrowed - matchedMarketCap + 1,
        completeSetCount: matchedMarketCap
      })
    );
  }

  function test_SubmitClearingRootRejectsDuplicateAndWrongStatus() public {
    uint256 activeMarketId = _createGraduatableMarket();
    uint256 graduatingMarketId = _createGraduatingMarketWithReceipt();
    MarketTypes.MarketState memory state = manager.getMarketState(graduatingMarketId);
    bytes32 merkleRoot = keccak256("clearing-root");
    uint256 matchedMarketCap = 50 * WAD;

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidMarketStatus.selector,
        activeMarketId,
        MarketTypes.MarketStatus.Active,
        MarketTypes.MarketStatus.Graduating
      )
    );
    manager.submitClearingRoot(
      MarketTypes.SubmitClearingRootParams({
        marketId: activeMarketId,
        merkleRoot: merkleRoot,
        matchedMarketCap: matchedMarketCap,
        retainedCostTotal: matchedMarketCap,
        refundTotal: 0,
        completeSetCount: matchedMarketCap
      })
    );

    manager.submitClearingRoot(
      MarketTypes.SubmitClearingRootParams({
        marketId: graduatingMarketId,
        merkleRoot: merkleRoot,
        matchedMarketCap: matchedMarketCap,
        retainedCostTotal: matchedMarketCap,
        refundTotal: state.totalEscrowed - matchedMarketCap,
        completeSetCount: matchedMarketCap
      })
    );

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.ClearingRootAlreadySubmitted.selector,
        graduatingMarketId
      )
    );
    manager.submitClearingRoot(
      MarketTypes.SubmitClearingRootParams({
        marketId: graduatingMarketId,
        merkleRoot: keccak256("second-root"),
        matchedMarketCap: matchedMarketCap,
        retainedCostTotal: matchedMarketCap,
        refundTotal: state.totalEscrowed - matchedMarketCap,
        completeSetCount: matchedMarketCap
      })
    );
  }

  function test_FinalizeGraduationFundsCompleteSetAdapterAfterChallenge() public {
    SubmittedClearingFixture memory fixture = _submitSingleReceiptClearingRoot();
    CompleteSetPostgradAdapter adapter = _deployPostgradAdapter();
    bytes32[] memory proof = new bytes32[](0);

    assertEq(adapter.postgradMarket(fixture.marketId), address(0));
    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidMarketStatus.selector,
        fixture.marketId,
        MarketTypes.MarketStatus.Graduating,
        MarketTypes.MarketStatus.Graduated
      )
    );
    manager.claimGraduatedReceipt(fixture.claim, proof);

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.ClearingChallengeActive.selector,
        fixture.marketId,
        fixture.challengeDeadline
      )
    );
    manager.finalizeGraduation(fixture.marketId, address(adapter));

    vm.warp(fixture.challengeDeadline);

    vm.expectRevert(PregradManager.InvalidPostgradAdapter.selector);
    manager.finalizeGraduation(fixture.marketId, address(0));

    manager.finalizeGraduation(fixture.marketId, address(adapter));

    address postgradMarketAddress = adapter.postgradMarket(fixture.marketId);
    CompleteSetPostgradAdapter.PreparedMarket memory prepared = adapter.getPreparedMarket(
      fixture.marketId
    );
    CompleteSetBinaryMarket postgradMarket = CompleteSetBinaryMarket(postgradMarketAddress);
    MarketTypes.MarketState memory state = manager.getMarketState(fixture.marketId);

    assertEq(uint256(state.status), uint256(MarketTypes.MarketStatus.Graduated));
    assertEq(state.totalEscrowed, fixture.refundTotal);
    assertEq(manager.getPostgradAdapter(fixture.marketId), address(adapter));
    assertTrue(prepared.prepared);
    assertEq(prepared.market, postgradMarketAddress);
    assertEq(prepared.collateral, address(collateral));
    assertEq(prepared.metadataHash, manager.getMarketConfig(fixture.marketId).metadataHash);
    assertEq(prepared.retainedCollateral, fixture.matchedMarketCap);
    assertEq(prepared.completeSetCount, fixture.matchedMarketCap);
    assertEq(postgradMarket.retainedMinter(), address(adapter));
    assertEq(postgradMarket.resolver(), address(this));
    assertEq(collateral.balanceOf(address(postgradMarket)), fixture.matchedMarketCap);
    assertEq(collateral.balanceOf(address(adapter)), 0);
    assertEq(collateral.balanceOf(address(manager)), fixture.refundTotal);
    assertEq(postgradMarket.yesToken().totalSupply(), 0);
    assertEq(postgradMarket.noToken().totalSupply(), 0);
  }

  function test_FinalizeGraduationRejectsMissingRootAndWrongStatus() public {
    CompleteSetPostgradAdapter adapter = _deployPostgradAdapter();
    uint256 activeMarketId = _createGraduatableMarket();
    uint256 graduatingMarketId = _createGraduatingMarketWithReceipt();

    vm.expectRevert(
      abi.encodeWithSelector(
        PregradManager.InvalidMarketStatus.selector,
        activeMarketId,
        MarketTypes.MarketStatus.Active,
        MarketTypes.MarketStatus.Graduating
      )
    );
    manager.finalizeGraduation(activeMarketId, address(adapter));

    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.ClearingRootMissing.selector, graduatingMarketId)
    );
    manager.finalizeGraduation(graduatingMarketId, address(adapter));
  }

  function test_ClaimGraduatedReceiptMintsCorrectSideAndRefunds() public {
    (
      SubmittedClearingFixture memory fixture,
      CompleteSetPostgradAdapter adapter,
      CompleteSetBinaryMarket postgradMarket
    ) = _finalizeSingleReceiptMarket();
    bytes32[] memory proof = new bytes32[](0);
    OutcomeToken yesToken = postgradMarket.yesToken();
    OutcomeToken noToken = postgradMarket.noToken();
    uint256 buyerBalanceBefore = collateral.balanceOf(fixture.buyer);

    vm.expectEmit(true, true, true, true, address(manager));
    emit GraduatedReceiptClaimed(
      fixture.receiptId,
      fixture.marketId,
      fixture.buyer,
      fixture.claim.side,
      fixture.claim.retainedShares,
      fixture.claim.retainedCost,
      fixture.claim.refund
    );

    manager.claimGraduatedReceipt(fixture.claim, proof);

    MarketTypes.Receipt memory receipt = manager.getReceipt(fixture.receiptId);
    MarketTypes.MarketState memory state = manager.getMarketState(fixture.marketId);

    assertFalse(receipt.active);
    assertEq(state.totalEscrowed, 0);
    assertEq(adapter.postgradMarket(fixture.marketId), address(postgradMarket));
    assertEq(yesToken.balanceOf(fixture.buyer), fixture.claim.retainedShares);
    assertEq(noToken.balanceOf(fixture.buyer), 0);
    assertEq(yesToken.totalSupply(), fixture.claim.retainedShares);
    assertEq(noToken.totalSupply(), 0);
    assertEq(collateral.balanceOf(fixture.buyer), buyerBalanceBefore + fixture.claim.refund);
    assertEq(collateral.balanceOf(address(manager)), 0);
    assertEq(collateral.balanceOf(address(postgradMarket)), fixture.claim.retainedCost);
  }

  function test_ClaimGraduatedReceiptRejectsInvalidProofAndDoubleClaim() public {
    (SubmittedClearingFixture memory fixture, , ) = _finalizeSingleReceiptMarket();
    bytes32[] memory proof = new bytes32[](0);
    MarketTypes.ReceiptClaim memory wrongLeaf = MarketTypes.ReceiptClaim({
      marketId: fixture.claim.marketId,
      receiptId: fixture.claim.receiptId,
      owner: fixture.claim.owner,
      side: fixture.claim.side,
      retainedShares: fixture.claim.retainedShares - 1,
      retainedCost: fixture.claim.retainedCost,
      refund: fixture.claim.refund
    });

    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.InvalidClaimProof.selector, fixture.receiptId)
    );
    manager.claimGraduatedReceipt(wrongLeaf, proof);

    manager.claimGraduatedReceipt(fixture.claim, proof);

    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.ReceiptAlreadyClaimed.selector, fixture.receiptId)
    );
    manager.claimGraduatedReceipt(fixture.claim, proof);
  }

  function test_ClaimGraduatedReceiptRejectsReceiptMismatch() public {
    (SubmittedClearingFixture memory fixture, , ) = _finalizeSingleReceiptMarket();
    bytes32[] memory proof = new bytes32[](0);
    MarketTypes.ReceiptClaim memory wrongCost = fixture.claim;
    ++wrongCost.refund;

    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.InvalidReceiptClaim.selector, fixture.receiptId)
    );
    manager.claimGraduatedReceipt(wrongCost, proof);
  }

  function test_AdapterCannotMintWithoutManagerApprovedClaim() public {
    (
      SubmittedClearingFixture memory fixture,
      CompleteSetPostgradAdapter adapter,
      CompleteSetBinaryMarket postgradMarket
    ) = _finalizeSingleReceiptMarket();
    address attacker = makeAddr("attacker");

    vm.prank(attacker);
    vm.expectRevert(
      abi.encodeWithSelector(
        CompleteSetPostgradAdapter.UnauthorizedPregradManager.selector,
        attacker
      )
    );
    adapter.distributeOutcome(fixture.marketId, attacker, MarketTypes.Side.Yes, 1 * WAD);

    vm.prank(attacker);
    vm.expectRevert(
      abi.encodeWithSelector(CompleteSetBinaryMarket.UnauthorizedRetainedMinter.selector, attacker)
    );
    postgradMarket.mintRetainedSide(attacker, MarketTypes.Side.Yes, 1 * WAD);

    assertEq(postgradMarket.yesToken().balanceOf(attacker), 0);
  }

  function test_ClaimRefundedReceiptReturnsFullEscrowOnce() public {
    address buyer = makeAddr("refund-buyer");
    uint256 marketId = _createDefaultMarket();
    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, MarketTypes.ReceiptQuote memory quote) = _placeReceiptAs(
      buyer,
      marketId,
      MarketTypes.Side.No,
      100 * WAD
    );
    MarketTypes.MarketConfig memory config = manager.getMarketConfig(marketId);
    vm.warp(config.graduationDeadline);
    manager.markRefundable(marketId);

    uint256 buyerBalanceBefore = collateral.balanceOf(buyer);

    vm.expectEmit(true, true, true, true, address(manager));
    emit RefundedReceiptClaimed(receiptId, marketId, buyer, quote.cost);

    manager.claimRefundedReceipt(receiptId);

    MarketTypes.Receipt memory receipt = manager.getReceipt(receiptId);
    MarketTypes.MarketState memory state = manager.getMarketState(marketId);

    assertFalse(receipt.active);
    assertEq(state.totalEscrowed, 0);
    assertEq(collateral.balanceOf(buyer), buyerBalanceBefore + quote.cost);
    assertEq(collateral.balanceOf(address(manager)), 0);

    vm.expectRevert(
      abi.encodeWithSelector(PregradManager.ReceiptAlreadyClaimed.selector, receiptId)
    );
    manager.claimRefundedReceipt(receiptId);
  }

  function test_HashReceiptClaimIsDeterministic() public view {
    MarketTypes.ReceiptClaim memory claim = MarketTypes.ReceiptClaim({
      marketId: 1,
      receiptId: 2,
      owner: address(0xBEEF),
      side: MarketTypes.Side.Yes,
      retainedShares: 30 * WAD,
      retainedCost: 15 * WAD,
      refund: 5 * WAD
    });

    bytes32 expectedHash = keccak256(
      abi.encode(
        manager.RECEIPT_CLAIM_TYPEHASH(),
        claim.marketId,
        claim.receiptId,
        claim.owner,
        uint8(claim.side),
        claim.retainedShares,
        claim.retainedCost,
        claim.refund
      )
    );

    assertEq(manager.hashReceiptClaim(claim), expectedHash);
  }

  function _submitSingleReceiptClearingRoot()
    private
    returns (SubmittedClearingFixture memory fixture)
  {
    address buyer = makeAddr("graduated-buyer");
    uint256 marketId = _createGraduatableMarket();

    _fundAndApprove(buyer, 1_000 * WAD);
    (uint256 receiptId, MarketTypes.ReceiptQuote memory quote) = _placeReceiptAs(
      buyer,
      marketId,
      MarketTypes.Side.Yes,
      100 * WAD
    );
    uint256 matchedMarketCap = 50 * WAD;
    assertGe(quote.cost, matchedMarketCap);

    MarketTypes.ReceiptClaim memory claim = MarketTypes.ReceiptClaim({
      marketId: marketId,
      receiptId: receiptId,
      owner: buyer,
      side: MarketTypes.Side.Yes,
      retainedShares: matchedMarketCap,
      retainedCost: matchedMarketCap,
      refund: quote.cost - matchedMarketCap
    });

    manager.startGraduation(marketId);
    manager.submitClearingRoot(
      MarketTypes.SubmitClearingRootParams({
        marketId: marketId,
        merkleRoot: manager.hashReceiptClaim(claim),
        matchedMarketCap: matchedMarketCap,
        retainedCostTotal: matchedMarketCap,
        refundTotal: claim.refund,
        completeSetCount: matchedMarketCap
      })
    );

    MarketTypes.ClearingRoot memory clearingRoot = manager.getClearingRoot(marketId);
    fixture = SubmittedClearingFixture({
      marketId: marketId,
      receiptId: receiptId,
      buyer: buyer,
      quote: quote,
      claim: claim,
      matchedMarketCap: matchedMarketCap,
      refundTotal: claim.refund,
      challengeDeadline: clearingRoot.challengeDeadline
    });
  }

  function _finalizeSingleReceiptMarket()
    private
    returns (
      SubmittedClearingFixture memory fixture,
      CompleteSetPostgradAdapter adapter,
      CompleteSetBinaryMarket postgradMarket
    )
  {
    fixture = _submitSingleReceiptClearingRoot();
    adapter = _deployPostgradAdapter();
    vm.warp(fixture.challengeDeadline);
    manager.finalizeGraduation(fixture.marketId, address(adapter));
    postgradMarket = CompleteSetBinaryMarket(adapter.postgradMarket(fixture.marketId));
  }

  function _deployPostgradAdapter() private returns (CompleteSetPostgradAdapter) {
    return
      new CompleteSetPostgradAdapter({
        pregradManager_: address(manager),
        owner_: address(this),
        resolver_: address(this),
        outcomeDecimals_: 18
      });
  }

  function _createDefaultMarket() private returns (uint256) {
    uint256 marketId = manager.createMarket(_defaultMarketParams(_defaultMetadataHash()));
    manager.approveMarket(marketId);
    return marketId;
  }

  function _createSecondDefaultMarket() private returns (uint256) {
    uint256 marketId = manager.createMarket(_defaultMarketParams(_defaultMetadataHash()));
    manager.approveMarket(marketId);
    return marketId;
  }

  function _createGraduatableMarket() private returns (uint256) {
    MarketTypes.CreateMarketParams memory params = _defaultMarketParams(_defaultMetadataHash());
    params.graduationThreshold = 50 * WAD;
    manager.setTrustedCreator(address(this), true);
    uint256 marketId = manager.createMarket(params);
    manager.approveMarket(marketId);
    return marketId;
  }

  function _createGraduatingMarketWithReceipt() private returns (uint256 marketId) {
    address buyer = makeAddr("graduating-buyer");
    marketId = _createGraduatableMarket();

    _fundAndApprove(buyer, 1_000 * WAD);
    _placeReceiptAs(buyer, marketId, MarketTypes.Side.Yes, 100 * WAD);

    manager.startGraduation(marketId);
  }

  function _defaultMarketParams(
    bytes32 metadataHash
  ) private view returns (MarketTypes.CreateMarketParams memory) {
    return
      MarketTypes.CreateMarketParams({
        collateral: address(collateral),
        metadataHash: metadataHash,
        metadata: _defaultMetadata(),
        openingProbabilityWad: (50 * WAD) / 100,
        liquidityParameter: 5_000 * WAD,
        graduationThreshold: 2_500 * WAD,
        graduationDeadline: uint64(block.timestamp + 7 days),
        resolutionTime: uint64(block.timestamp + 14 days),
        bypassAiResolution: false
      });
  }

  function _longMetadata() private view returns (string memory) {
    bytes memory prefix = bytes(_defaultMetadata());
    bytes memory value = new bytes(manager.MAX_METADATA_BYTES() + 1);
    for (uint256 index = 0; index < prefix.length; ++index) {
      value[index] = prefix[index];
    }
    for (uint256 index = prefix.length; index < value.length; ++index) {
      value[index] = "x";
    }
    return string(value);
  }

  function _defaultMetadata() private pure returns (string memory) {
    // solhint-disable quotes
    return
      string.concat(
        '{"version":1,"question":"Will this test market resolve?",',
        '"description":"","category":"Test",',
        '"resolutionCriteria":"Resolves according to test fixtures.",',
        '"createdAt":"2026-01-01T00:00:00.000Z"}'
      );
    // solhint-enable quotes
  }

  function _defaultMetadataHash() private pure returns (bytes32) {
    return keccak256(bytes(_defaultMetadata()));
  }

  function _fundAndApprove(address account, uint256 amount) private {
    collateral.mint(account, amount);
    vm.prank(account);
    collateral.approve(address(manager), type(uint256).max);
  }

  function _placeReceiptAs(
    address buyer,
    uint256 marketId,
    MarketTypes.Side side,
    uint256 shares
  ) private returns (uint256 receiptId, MarketTypes.ReceiptQuote memory quote) {
    quote = manager.quoteReceipt(marketId, side, shares);

    vm.prank(buyer);
    receiptId = manager.placeReceipt(
      MarketTypes.PlaceReceiptParams({
        marketId: marketId,
        side: side,
        shares: shares,
        maxCost: quote.cost
      })
    );
  }

  function _expectedSnapshotHash(
    uint256 marketId,
    uint256 receiptCount,
    uint256 totalEscrowed,
    int256 path,
    uint256 yesShares,
    uint256 noShares,
    uint64 graduationStartedAt
  ) private view returns (bytes32) {
    return
      keccak256(
        abi.encode(
          manager.GRADUATION_SNAPSHOT_TYPEHASH(),
          block.chainid,
          address(manager),
          marketId,
          receiptCount,
          totalEscrowed,
          path,
          yesShares,
          noShares,
          graduationStartedAt
        )
      );
  }
}
