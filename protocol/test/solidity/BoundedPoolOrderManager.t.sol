// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {PoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-periphery/lib/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-periphery/lib/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolKey.sol";
import {
  ModifyLiquidityParams,
  SwapParams
} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolOperation.sol";
import {StateView} from "@uniswap/v4-periphery/src/lens/StateView.sol";
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {BoundedPredictionHook} from "../../contracts/v4/BoundedPredictionHook.sol";
import {
  BoundedPoolOrderManager,
  ITokenPuller
} from "../../contracts/v4/BoundedPoolOrderManager.sol";
import {IBoundedPoolOrderManager} from "../../contracts/v4/interfaces/IBoundedPoolOrderManager.sol";
import {MinimalV4SwapRouter} from "../../contracts/v4/MinimalV4SwapRouter.sol";
import {PoolTickBounds} from "../../contracts/v4/PoolTickBounds.sol";
import {AllowanceTransferMock} from "./mocks/AllowanceTransferMock.sol";
import {V4TestERC20} from "./mocks/V4TestERC20.sol";

contract BoundedPoolOrderManagerTest is Test {
  error UnableToDeploySortedPoolPair();
  error DeferredExecutionStoredLogMissing();

  address private constant MAKER = address(0xA11CE);
  address private constant TAKER = address(0xB0B);
  address private constant RESOLVER = address(0xC0DE);
  uint24 private constant FEE = 3000;
  int24 private constant TICK_SPACING = 60;
  int24 private constant BASE_TICK_LOWER = -600;
  int24 private constant BASE_TICK_UPPER = 600;
  int24 private constant ORDER_TICK_LOWER = 60;
  int24 private constant ORDER_TICK_UPPER = 120;
  int24 private constant PARTIAL_ORDER_TICK_UPPER = 240;
  uint128 private constant BASE_LIQUIDITY = 100_000e18;
  uint256 private constant ORDER_AMOUNT = 100e18;
  uint256 private constant STARTING_BALANCE = 1_000_000e18;
  bytes32 private constant DEFERRED_EXECUTION_STORED_TOPIC = keccak256(
    "DeferredExecutionStored(bytes32,bytes32,int24,int24,uint256)"
  );

  PoolManager private poolManager;
  StateView private stateView;
  MinimalV4SwapRouter private router;
  PoolTickBounds private poolTickBounds;
  AllowanceTransferMock private allowanceTransfer;
  BoundedPoolOrderManager private orderManager;
  BoundedPredictionHook private hook;
  V4TestERC20 private token0;
  V4TestERC20 private token1;
  PoolKey private poolKey;
  PoolId private poolId;

  function setUp() public {
    poolManager = new PoolManager(address(this));
    stateView = new StateView(IPoolManager(address(poolManager)));
    router = new MinimalV4SwapRouter(IPoolManager(address(poolManager)));
    poolTickBounds = new PoolTickBounds(address(this));
    allowanceTransfer = new AllowanceTransferMock();
    orderManager = new BoundedPoolOrderManager(
      IPoolManager(address(poolManager)),
      ITokenPuller(address(allowanceTransfer)),
      address(this)
    );
    hook = _deployHookAtPermissionedAddress();

    (token0, token1) = _deploySortedPoolTokens();
    token0.mint(address(this), STARTING_BALANCE);
    token1.mint(address(this), STARTING_BALANCE);
    token0.mint(MAKER, STARTING_BALANCE);
    token1.mint(MAKER, STARTING_BALANCE);
    token0.mint(TAKER, STARTING_BALANCE);
    token1.mint(TAKER, STARTING_BALANCE);
    token0.approve(address(router), type(uint256).max);
    token1.approve(address(router), type(uint256).max);
    vm.prank(TAKER);
    token0.approve(address(router), type(uint256).max);
    vm.prank(TAKER);
    token1.approve(address(router), type(uint256).max);
    vm.prank(MAKER);
    token0.approve(address(allowanceTransfer), type(uint256).max);
    vm.prank(MAKER);
    token1.approve(address(allowanceTransfer), type(uint256).max);

    poolKey = PoolKey({
      currency0: Currency.wrap(address(token0)),
      currency1: Currency.wrap(address(token1)),
      fee: FEE,
      tickSpacing: TICK_SPACING,
      hooks: IHooks(address(hook))
    });
    poolId = poolKey.toId();

    poolTickBounds.setPoolTickBounds(poolId, BASE_TICK_LOWER, BASE_TICK_UPPER);
    orderManager.setHookRole(address(hook), true);
    orderManager.setPoolWhitelisted(poolKey, true);
    orderManager.setMinimumOrderAmount(address(token0), 1e18);
    orderManager.setMinimumOrderAmount(address(token1), 1e18);

    int24 initializedTick = poolManager.initialize(poolKey, TickMath.getSqrtPriceAtTick(0));
    assertEq(initializedTick, 0);
    _addBaseLiquidity();
  }

  function test_CreateOrderAddsOneSidedLiquidity() public {
    (uint32 orderId, uint128 liquidity, uint256 amountIn) = _createMakerOrder();

    BoundedPoolOrderManager.Order memory order = orderManager.getOrder(poolId, orderId);
    assertEq(order.owner, MAKER);
    assertTrue(order.zeroForOne);
    assertEq(order.tickLower, ORDER_TICK_LOWER);
    assertEq(order.tickUpper, ORDER_TICK_UPPER);
    assertEq(order.liquidity, liquidity);
    assertGt(amountIn, 0);

    (uint128 positionLiquidity, , ) = stateView.getPositionInfo(
      poolId,
      address(orderManager),
      ORDER_TICK_LOWER,
      ORDER_TICK_UPPER,
      bytes32(uint256(orderId))
    );
    assertEq(positionLiquidity, liquidity);
    assertEq(token0.balanceOf(MAKER), STARTING_BALANCE - amountIn);
  }

  function test_TakerSwapCrossesThresholdPaysMakerAndDeletesOrder() public {
    (uint32 orderId, , ) = _createMakerOrder();
    uint256 makerToken1Before = token1.balanceOf(MAKER);

    vm.prank(TAKER);
    router.swap(
      poolKey,
      SwapParams({
        zeroForOne: false,
        amountSpecified: -int256(10_000e18),
        sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(240)
      }),
      TAKER,
      ""
    );

    BoundedPoolOrderManager.Order memory order = orderManager.getOrder(poolId, orderId);
    assertEq(order.owner, address(0));
    assertGt(token1.balanceOf(MAKER), makerToken1Before);

    (uint128 positionLiquidity, , ) = stateView.getPositionInfo(
      poolId,
      address(orderManager),
      ORDER_TICK_LOWER,
      ORDER_TICK_UPPER,
      bytes32(uint256(orderId))
    );
    assertEq(positionLiquidity, 0);
  }

  function test_CancelReturnsRemainingInventoryAndDeletesOrder() public {
    (uint32 orderId, , uint256 amountIn) = _createMakerOrder();
    uint256 makerToken0AfterCreate = token0.balanceOf(MAKER);

    vm.prank(MAKER);
    (uint256 amount0, uint256 amount1) = orderManager.cancelOrder(poolKey, orderId, "");

    assertGt(amount0, 0);
    assertEq(amount1, 0);
    assertEq(token0.balanceOf(MAKER), makerToken0AfterCreate + amount0);
    assertGe(token0.balanceOf(MAKER) + 2, STARTING_BALANCE);
    assertLe(token0.balanceOf(MAKER), STARTING_BALANCE);
    assertLe(amount0, amountIn);

    BoundedPoolOrderManager.Order memory order = orderManager.getOrder(poolId, orderId);
    assertEq(order.owner, address(0));
  }

  function test_ReversedMovementLeavesOrderIndexed() public {
    (uint32 orderId, , ) = _createMakerOrder();

    vm.prank(address(hook));
    orderManager.movePoolTick(poolKey, 0, -60, TickMath.getSqrtPriceAtTick(-60));

    BoundedPoolOrderManager.Order memory order = orderManager.getOrder(poolId, orderId);
    assertEq(order.owner, MAKER);

    vm.prank(TAKER);
    router.swap(
      poolKey,
      SwapParams({
        zeroForOne: false,
        amountSpecified: -int256(10_000e18),
        sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(240)
      }),
      TAKER,
      ""
    );

    order = orderManager.getOrder(poolId, orderId);
    assertEq(order.owner, address(0));
  }

  function test_LargeCrossedRangeSplitsImmediateAndDeferredBatches() public {
    orderManager.setMaximumExecutionCount(1);
    uint32[] memory orderIds = _createMakerOrders(3);

    vm.recordLogs();
    _movePriceUp();
    bytes32 executionId = _lastDeferredExecutionId();

    assertEq(_activeOrderCount(orderIds), 2);
    (
      bool pending,
      PoolId deferredPoolId,
      int24 fromTick,
      int24 toTick,
      ,
      uint256 nextOrderIndex,
      uint256 orderCount,
      uint256 remainingOrderCount
    ) = orderManager.getDeferredExecution(executionId);
    assertTrue(pending);
    assertEq(PoolId.unwrap(deferredPoolId), PoolId.unwrap(poolId));
    assertEq(fromTick, 0);
    assertGt(toTick, ORDER_TICK_UPPER);
    assertEq(nextOrderIndex, 0);
    assertEq(orderCount, 2);
    assertEq(remainingOrderCount, 2);

    (uint256 processedCount, bool complete) = orderManager.resolveDeferredExecution(executionId, 0);
    assertEq(processedCount, 1);
    assertFalse(complete);
    assertEq(_activeOrderCount(orderIds), 1);

    (processedCount, complete) = orderManager.resolveDeferredExecution(executionId, 0);
    assertEq(processedCount, 1);
    assertTrue(complete);
    assertEq(_activeOrderCount(orderIds), 0);

    (pending, , , , , , orderCount, remainingOrderCount) = orderManager.getDeferredExecution(
      executionId
    );
    assertFalse(pending);
    assertEq(orderCount, 0);
    assertEq(remainingOrderCount, 0);
  }

  function test_DeferredResolutionRequiresResolverRole() public {
    orderManager.setMaximumExecutionCount(1);
    _createMakerOrders(2);

    vm.recordLogs();
    _movePriceUp();
    bytes32 executionId = _lastDeferredExecutionId();

    vm.expectRevert(
      abi.encodeWithSelector(BoundedPoolOrderManager.UnauthorizedResolver.selector, TAKER)
    );
    vm.prank(TAKER);
    orderManager.resolveDeferredExecution(executionId, 1);

    orderManager.setResolverRole(RESOLVER, true);
    vm.prank(RESOLVER);
    (uint256 processedCount, bool complete) = orderManager.resolveDeferredExecution(executionId, 1);
    assertEq(processedCount, 1);
    assertTrue(complete);
  }

  function test_DeferredResolutionAfterPriceReversalRequeuesOrder() public {
    orderManager.setMaximumExecutionCount(1);
    uint32[] memory orderIds = _createMakerOrders(2);

    vm.recordLogs();
    _movePriceUp();
    bytes32 executionId = _lastDeferredExecutionId();
    assertEq(_activeOrderCount(orderIds), 1);

    _movePriceDown();

    (uint256 processedCount, bool complete) = orderManager.resolveDeferredExecution(executionId, 0);
    assertEq(processedCount, 1);
    assertTrue(complete);
    assertEq(_activeOrderCount(orderIds), 1);

    _movePriceUp();
    assertEq(_activeOrderCount(orderIds), 0);
  }

  function test_PartialFillPaysMakerAndReaddsRemainingLiquidity() public {
    (uint32 orderId, uint128 initialLiquidity, ) = _createPartialMakerOrder();
    uint256 makerToken1Before = token1.balanceOf(MAKER);

    _movePriceUpTo(120);

    BoundedPoolOrderManager.Order memory order = orderManager.getOrder(poolId, orderId);
    assertEq(order.owner, MAKER);
    assertTrue(order.enablePartialFill);
    assertGt(order.tickLower, ORDER_TICK_LOWER);
    assertEq(order.tickUpper, PARTIAL_ORDER_TICK_UPPER);
    assertGe(order.indexedTick, order.tickLower);
    assertLe(order.indexedTick, order.tickUpper);
    assertGt(initialLiquidity, order.liquidity);
    assertGt(order.liquidity, 0);
    assertGt(token1.balanceOf(MAKER), makerToken1Before);
    assertEq(_positionLiquidity(orderId, ORDER_TICK_LOWER, PARTIAL_ORDER_TICK_UPPER), 0);
    assertEq(_positionLiquidity(orderId, order.tickLower, order.tickUpper), order.liquidity);
  }

  function test_CancelAfterPartialFillReturnsRemainingInventory() public {
    (uint32 orderId, , ) = _createPartialMakerOrder();
    _movePriceUpTo(120);

    BoundedPoolOrderManager.Order memory order = orderManager.getOrder(poolId, orderId);
    uint256 makerToken0BeforeCancel = token0.balanceOf(MAKER);

    vm.prank(MAKER);
    (uint256 amount0, uint256 amount1) = orderManager.cancelOrder(poolKey, orderId, "");

    assertGt(amount0, 0);
    assertEq(amount1, 0);
    assertEq(token0.balanceOf(MAKER), makerToken0BeforeCancel + amount0);
    assertEq(_positionLiquidity(orderId, order.tickLower, order.tickUpper), 0);

    order = orderManager.getOrder(poolId, orderId);
    assertEq(order.owner, address(0));
  }

  function test_PartialFillCanLaterFullyFill() public {
    (uint32 orderId, , ) = _createPartialMakerOrder();
    _movePriceUpTo(120);
    BoundedPoolOrderManager.Order memory order = orderManager.getOrder(poolId, orderId);
    uint256 makerToken1AfterPartial = token1.balanceOf(MAKER);
    int24 remainingTickLower = order.tickLower;
    int24 remainingTickUpper = order.tickUpper;

    _movePriceUpTo(360);

    order = orderManager.getOrder(poolId, orderId);
    assertEq(order.owner, address(0));
    assertGt(token1.balanceOf(MAKER), makerToken1AfterPartial);
    assertEq(_positionLiquidity(orderId, remainingTickLower, remainingTickUpper), 0);
  }

  function test_DeferredExecutionCanPartiallyFillRemainingBatch() public {
    orderManager.setMaximumExecutionCount(1);
    uint32[] memory orderIds = _createPartialMakerOrders(2);
    uint256 makerToken1Before = token1.balanceOf(MAKER);

    vm.recordLogs();
    _movePriceUpTo(120);
    bytes32 executionId = _lastDeferredExecutionId();

    assertEq(_activeOrderCount(orderIds), 2);

    (uint256 processedCount, bool complete) = orderManager.resolveDeferredExecution(executionId, 0);
    assertEq(processedCount, 1);
    assertTrue(complete);
    assertEq(_activeOrderCount(orderIds), 2);
    assertGt(token1.balanceOf(MAKER), makerToken1Before);

    orderManager.setMaximumExecutionCount(type(uint256).max);
    _movePriceUpTo(360);
    assertEq(_activeOrderCount(orderIds), 0);
  }

  function test_RejectsUnauthorizedPoolsHooksAndCancels() public {
    PoolKey memory unlistedKey = poolKey;
    unlistedKey.fee = 500;

    vm.expectRevert(
      abi.encodeWithSelector(
        BoundedPoolOrderManager.PoolNotWhitelisted.selector,
        unlistedKey.toId()
      )
    );
    vm.prank(MAKER);
    orderManager.createOrder(
      BoundedPoolOrderManager.CreateOrderParams({
        key: unlistedKey,
        zeroForOne: true,
        tickLower: ORDER_TICK_LOWER,
        tickUpper: ORDER_TICK_UPPER,
        amountInMaximum: ORDER_AMOUNT,
        enablePartialFill: false,
        hookData: ""
      })
    );

    (uint32 orderId, , ) = _createMakerOrder();
    vm.expectRevert(
      abi.encodeWithSelector(BoundedPoolOrderManager.UnauthorizedOrderOwner.selector, TAKER, MAKER)
    );
    vm.prank(TAKER);
    orderManager.cancelOrder(poolKey, orderId, "");

    vm.expectRevert(
      abi.encodeWithSelector(BoundedPoolOrderManager.UnauthorizedHook.selector, TAKER)
    );
    vm.prank(TAKER);
    orderManager.movePoolTick(poolKey, 0, 120, TickMath.getSqrtPriceAtTick(120));
  }

  function _createMakerOrder()
    private
    returns (uint32 orderId, uint128 liquidity, uint256 amountIn)
  {
    return _createMakerOrderWithConfig(false, ORDER_TICK_LOWER, ORDER_TICK_UPPER);
  }

  function _createPartialMakerOrder()
    private
    returns (uint32 orderId, uint128 liquidity, uint256 amountIn)
  {
    return _createMakerOrderWithConfig(true, ORDER_TICK_LOWER, PARTIAL_ORDER_TICK_UPPER);
  }

  function _createMakerOrderWithConfig(
    bool enablePartialFill,
    int24 tickLower,
    int24 tickUpper
  ) private returns (uint32 orderId, uint128 liquidity, uint256 amountIn) {
    vm.prank(MAKER);
    return
      orderManager.createOrder(
        BoundedPoolOrderManager.CreateOrderParams({
          key: poolKey,
          zeroForOne: true,
          tickLower: tickLower,
          tickUpper: tickUpper,
          amountInMaximum: ORDER_AMOUNT,
          enablePartialFill: enablePartialFill,
          hookData: ""
        })
      );
  }

  function _createMakerOrders(uint256 orderCount) private returns (uint32[] memory orderIds) {
    orderIds = new uint32[](orderCount);
    for (uint256 i = 0; i < orderCount; ++i) {
      (orderIds[i], , ) = _createMakerOrder();
    }
  }

  function _createPartialMakerOrders(
    uint256 orderCount
  ) private returns (uint32[] memory orderIds) {
    orderIds = new uint32[](orderCount);
    for (uint256 i = 0; i < orderCount; ++i) {
      (orderIds[i], , ) = _createPartialMakerOrder();
    }
  }

  function _activeOrderCount(uint32[] memory orderIds) private view returns (uint256 count) {
    for (uint256 i = 0; i < orderIds.length; ++i) {
      BoundedPoolOrderManager.Order memory order = orderManager.getOrder(poolId, orderIds[i]);
      if (order.owner != address(0)) {
        ++count;
      }
    }
  }

  function _lastDeferredExecutionId() private returns (bytes32 executionId) {
    Vm.Log[] memory entries = vm.getRecordedLogs();
    for (uint256 i = entries.length; i > 0; --i) {
      Vm.Log memory entry = entries[i - 1];
      if (entry.topics.length > 1 && entry.topics[0] == DEFERRED_EXECUTION_STORED_TOPIC) {
        return entry.topics[1];
      }
    }

    revert DeferredExecutionStoredLogMissing();
  }

  function _movePriceUp() private {
    _movePriceUpTo(240);
  }

  function _movePriceUpTo(int24 tick) private {
    vm.prank(TAKER);
    router.swap(
      poolKey,
      SwapParams({
        zeroForOne: false,
        amountSpecified: -int256(10_000e18),
        sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(tick)
      }),
      TAKER,
      ""
    );
  }

  function _movePriceDown() private {
    vm.prank(TAKER);
    router.swap(
      poolKey,
      SwapParams({
        zeroForOne: true,
        amountSpecified: -int256(10_000e18),
        sqrtPriceLimitX96: TickMath.getSqrtPriceAtTick(-240)
      }),
      TAKER,
      ""
    );
  }

  function _positionLiquidity(
    uint32 orderId,
    int24 tickLower,
    int24 tickUpper
  ) private view returns (uint128 liquidity) {
    (liquidity, , ) = stateView.getPositionInfo(
      poolId,
      address(orderManager),
      tickLower,
      tickUpper,
      bytes32(uint256(orderId))
    );
  }

  function _deployHookAtPermissionedAddress() private returns (BoundedPredictionHook deployedHook) {
    bytes memory constructorArgs = abi.encode(
      IPoolManager(address(poolManager)),
      poolTickBounds,
      IBoundedPoolOrderManager(address(orderManager))
    );
    (address hookAddress, bytes32 salt) = HookMiner.find(
      address(this),
      Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG,
      type(BoundedPredictionHook).creationCode,
      constructorArgs
    );

    deployedHook = new BoundedPredictionHook{salt: salt}(
      IPoolManager(address(poolManager)),
      poolTickBounds,
      IBoundedPoolOrderManager(address(orderManager))
    );
    assertEq(address(deployedHook), hookAddress);
  }

  function _addBaseLiquidity() private {
    (BalanceDelta liquidityDelta, ) = router.modifyLiquidity(
      poolKey,
      ModifyLiquidityParams({
        tickLower: BASE_TICK_LOWER,
        tickUpper: BASE_TICK_UPPER,
        liquidityDelta: int256(uint256(BASE_LIQUIDITY)),
        salt: bytes32(0)
      }),
      ""
    );

    assertTrue(liquidityDelta.amount0() < 0);
    assertTrue(liquidityDelta.amount1() < 0);
  }

  function _deploySortedPoolTokens()
    private
    returns (V4TestERC20 sortedToken0, V4TestERC20 sortedToken1)
  {
    for (uint256 i = 0; i < 32; ++i) {
      V4TestERC20 first = new V4TestERC20("First Test Token", "TOK0", 18);
      V4TestERC20 second = new V4TestERC20("Second Test Token", "TOK1", 18);

      if (address(first) < address(second)) {
        return (first, second);
      }
    }

    revert UnableToDeploySortedPoolPair();
  }
}
