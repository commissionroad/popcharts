// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

// solhint-disable use-natspec

// ADR 0017 Track D: stateful escrow-conservation invariants over the
// bounded-pool order manager. A handler drives random create/cancel/swap/
// resolve sequences; the invariants assert the manager custodies nothing,
// every live order's book entry is backed 1:1 by pool liquidity, and value
// only ever moves between actors and the pool.
//
// NOTE: like BoundedPoolOrderManager.t.sol, this suite does not inherit
// BaseTest — the v4 family pins solc 0.8.26.

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Vm} from "forge-std/Vm.sol";
import {PoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IPoolManager.sol";
import {Hooks} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/Hooks.sol";
import {TickMath} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/TickMath.sol";
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

contract OrderManagerInvariantHandler is Test {
  int24 internal constant TICK_SPACING = 60;
  int24 internal constant BOUND_TICK_LOWER = -600;
  int24 internal constant BOUND_TICK_UPPER = 600;
  uint256 internal constant MIN_ORDER_AMOUNT = 1e18;
  uint256 internal constant MAX_ORDER_AMOUNT = 1_000e18;
  uint256 internal constant MAX_SWAP_AMOUNT = 5_000e18;
  uint256 internal constant MAX_LIVE_ORDERS = 24;

  BoundedPoolOrderManager internal immutable ORDER_MANAGER;
  MinimalV4SwapRouter internal immutable ROUTER;
  StateView internal immutable STATE_VIEW;
  V4TestERC20 internal immutable TOKEN0;
  V4TestERC20 internal immutable TOKEN1;
  PoolId internal poolId;
  PoolKey internal poolKey;

  address[2] internal makers = [address(0xA11CE), address(0xA22CE)];
  address internal taker = address(0xB0B);

  uint32[] internal liveOrderIds;
  bytes32[] internal pendingExecutionIds;

  // Op counters so a run that silently no-ops everything is detectable.
  uint256 public createCalls;
  uint256 public cancelCalls;
  uint256 public swapCalls;
  uint256 public resolveCalls;

  constructor(
    BoundedPoolOrderManager orderManager,
    MinimalV4SwapRouter router,
    StateView stateView,
    V4TestERC20 token0,
    V4TestERC20 token1,
    PoolKey memory key
  ) {
    ORDER_MANAGER = orderManager;
    ROUTER = router;
    STATE_VIEW = stateView;
    TOKEN0 = token0;
    TOKEN1 = token1;
    poolKey = key;
    poolId = key.toId();
  }

  function liveOrders() external view returns (uint32[] memory) {
    return liveOrderIds;
  }

  function createOrder(
    uint256 seed,
    uint256 amountSeed,
    bool zeroForOne,
    bool allowPartial
  ) external {
    if (liveOrderIds.length >= MAX_LIVE_ORDERS) {
      return;
    }

    (, int24 currentTick, , ) = STATE_VIEW.getSlot0(poolId);
    (int24 tickLower, int24 tickUpper) = _orderRange(seed, currentTick, zeroForOne);
    if (tickLower >= tickUpper) {
      return; // No room on that side of the current tick.
    }

    address maker = makers[seed % makers.length];
    uint256 amount = bound(amountSeed, MIN_ORDER_AMOUNT, MAX_ORDER_AMOUNT);

    vm.prank(maker);
    (uint32 orderId, , ) = ORDER_MANAGER.createOrder(
      BoundedPoolOrderManager.CreateOrderParams({
        key: poolKey,
        zeroForOne: zeroForOne,
        tickLower: tickLower,
        tickUpper: tickUpper,
        amountInMaximum: amount,
        enablePartialFill: allowPartial,
        hookData: ""
      })
    );
    liveOrderIds.push(orderId);
    ++createCalls;
  }

  function cancelOrder(uint256 seed) external {
    uint256 live = liveOrderIds.length;
    if (live == 0) {
      return;
    }

    uint256 index = seed % live;
    uint32 orderId = liveOrderIds[index];
    BoundedPoolOrderManager.Order memory order = ORDER_MANAGER.getOrder(poolId, orderId);
    if (order.owner == address(0)) {
      // Consumed by an execution since we recorded it; drop the stale entry.
      _dropLiveOrder(index);
      return;
    }

    vm.prank(order.owner);
    ORDER_MANAGER.cancelOrder(poolKey, orderId, "");
    _dropLiveOrder(index);
    ++cancelCalls;
  }

  function swap(uint256 amountSeed, bool zeroForOne) external {
    uint256 amountIn = bound(amountSeed, 1e15, MAX_SWAP_AMOUNT);
    uint160 priceLimit =
      zeroForOne
        ? TickMath.getSqrtPriceAtTick(BOUND_TICK_LOWER) + 1
        : TickMath.getSqrtPriceAtTick(BOUND_TICK_UPPER) - 1;

    vm.recordLogs();
    vm.prank(taker);
    ROUTER.swap(
      poolKey,
      SwapParams({
        zeroForOne: zeroForOne,
        amountSpecified: -int256(amountIn),
        sqrtPriceLimitX96: priceLimit
      }),
      taker,
      ""
    );
    _harvestDeferredExecutions();
    ++swapCalls;
  }

  function resolveDeferred(uint256 seed, uint256 countSeed) external {
    uint256 pendingCount = pendingExecutionIds.length;
    if (pendingCount == 0) {
      return;
    }

    uint256 index = seed % pendingCount;
    bytes32 executionId = pendingExecutionIds[index];
    (bool pending, , , , , , , ) = ORDER_MANAGER.getDeferredExecution(executionId);
    if (!pending) {
      _dropPendingExecution(index);
      return;
    }

    (, bool complete) = ORDER_MANAGER.resolveDeferredExecution(executionId, bound(countSeed, 0, 4));
    if (complete) {
      _dropPendingExecution(index);
    }
    ++resolveCalls;
  }

  function _orderRange(
    uint256 seed,
    int24 currentTick,
    bool zeroForOne
  ) private pure returns (int24 tickLower, int24 tickUpper) {
    int24 widthSpacings = int24(int256(1 + (seed % 3)));
    if (zeroForOne) {
      // Range must sit strictly above the current tick.
      int24 firstAligned = _ceilToSpacing(currentTick + 1);
      tickLower = firstAligned;
      tickUpper = tickLower + widthSpacings * TICK_SPACING;
      if (tickUpper > BOUND_TICK_UPPER) {
        tickUpper = BOUND_TICK_UPPER;
      }
      return (tickLower, tickUpper);
    }

    // Range must sit strictly below the current tick.
    int24 lastAligned = _floorToSpacing(currentTick - 1);
    tickUpper = lastAligned;
    tickLower = tickUpper - widthSpacings * TICK_SPACING;
    if (tickLower < BOUND_TICK_LOWER) {
      tickLower = BOUND_TICK_LOWER;
    }
  }

  function _harvestDeferredExecutions() private {
    Vm.Log[] memory logs = vm.getRecordedLogs();
    bytes32 topic = keccak256("DeferredExecutionStored(bytes32,bytes32,int24,int24,uint256)");
    for (uint256 i = 0; i < logs.length; ++i) {
      if (logs[i].topics.length > 1 && logs[i].topics[0] == topic) {
        pendingExecutionIds.push(logs[i].topics[1]);
      }
    }
  }

  function _dropLiveOrder(uint256 index) private {
    liveOrderIds[index] = liveOrderIds[liveOrderIds.length - 1];
    liveOrderIds.pop();
  }

  function _dropPendingExecution(uint256 index) private {
    pendingExecutionIds[index] = pendingExecutionIds[pendingExecutionIds.length - 1];
    pendingExecutionIds.pop();
  }

  function _ceilToSpacing(int24 tick) private pure returns (int24) {
    int24 floored = _floorToSpacing(tick);
    return floored == tick ? floored : floored + TICK_SPACING;
  }

  function _floorToSpacing(int24 tick) private pure returns (int24) {
    int256 quotient = int256(tick) / int256(TICK_SPACING);
    if (tick < 0 && int256(tick) % int256(TICK_SPACING) != 0) {
      --quotient;
    }
    return int24(quotient * int256(TICK_SPACING));
  }
}

contract BoundedPoolOrderManagerInvariantTest is StdInvariant, Test {
  error UnableToDeploySortedPoolPair();

  uint24 private constant FEE = 3000;
  int24 private constant TICK_SPACING = 60;
  int24 private constant BASE_TICK_LOWER = -600;
  int24 private constant BASE_TICK_UPPER = 600;
  uint128 private constant BASE_LIQUIDITY = 100_000e18;
  uint256 private constant STARTING_BALANCE = 1_000_000e18;

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
  OrderManagerInvariantHandler private handler;

  uint256 private initialTotal0;
  uint256 private initialTotal1;

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
    poolKey = PoolKey({
      currency0: Currency.wrap(address(token0)),
      currency1: Currency.wrap(address(token1)),
      fee: FEE,
      tickSpacing: TICK_SPACING,
      hooks: IHooks(address(hook))
    });
    poolId = poolKey.toId();

    handler = new OrderManagerInvariantHandler(
      orderManager,
      router,
      stateView,
      token0,
      token1,
      poolKey
    );

    token0.mint(address(this), STARTING_BALANCE);
    token1.mint(address(this), STARTING_BALANCE);
    token0.approve(address(router), type(uint256).max);
    token1.approve(address(router), type(uint256).max);
    address[3] memory actors = [address(0xA11CE), address(0xA22CE), address(0xB0B)];
    for (uint256 i = 0; i < actors.length; ++i) {
      token0.mint(actors[i], STARTING_BALANCE);
      token1.mint(actors[i], STARTING_BALANCE);
      vm.startPrank(actors[i]);
      token0.approve(address(allowanceTransfer), type(uint256).max);
      token1.approve(address(allowanceTransfer), type(uint256).max);
      token0.approve(address(router), type(uint256).max);
      token1.approve(address(router), type(uint256).max);
      vm.stopPrank();
    }

    poolTickBounds.setPoolTickBounds(poolId, BASE_TICK_LOWER, BASE_TICK_UPPER);
    orderManager.setHookRole(address(hook), true);
    orderManager.setPoolWhitelisted(poolKey, true);
    orderManager.setMinimumOrderAmount(address(token0), 1e18);
    orderManager.setMinimumOrderAmount(address(token1), 1e18);
    orderManager.setResolverRole(address(handler), true);

    poolManager.initialize(poolKey, TickMath.getSqrtPriceAtTick(0));
    router.modifyLiquidity(
      poolKey,
      ModifyLiquidityParams({
        tickLower: BASE_TICK_LOWER,
        tickUpper: BASE_TICK_UPPER,
        liquidityDelta: int256(uint256(BASE_LIQUIDITY)),
        salt: bytes32(0)
      }),
      ""
    );

    initialTotal0 = token0.totalSupply();
    initialTotal1 = token1.totalSupply();

    targetContract(address(handler));
  }

  /// The manager and every non-custodial component must never hold tokens:
  /// maker escrow lives in the pool as liquidity, and proceeds are taken
  /// straight to their owners. A nonzero balance here is stranded or
  /// skimmed value.
  function invariant_NonCustodialComponentsHoldNothing() public view {
    address[6] memory nonCustodial = [
      address(orderManager),
      address(router),
      address(hook),
      address(allowanceTransfer),
      address(poolTickBounds),
      address(handler)
    ];
    for (uint256 i = 0; i < nonCustodial.length; ++i) {
      assertEq(token0.balanceOf(nonCustodial[i]), 0, "token0 stranded");
      assertEq(token1.balanceOf(nonCustodial[i]), 0, "token1 stranded");
    }
  }

  /// Every live order the handler knows about is either consumed (owner
  /// deleted) or backed 1:1 by pool liquidity at exactly its recorded range
  /// and salt. Book/pool divergence is how escrow silently corrupts.
  function invariant_LiveOrdersBackedByPoolPositions() public view {
    uint32[] memory orderIds = handler.liveOrders();
    for (uint256 i = 0; i < orderIds.length; ++i) {
      BoundedPoolOrderManager.Order memory order = orderManager.getOrder(poolId, orderIds[i]);
      if (order.owner == address(0)) {
        continue; // Filled and deleted between handler calls.
      }

      (uint128 positionLiquidity, , ) = stateView.getPositionInfo(
        poolId,
        address(orderManager),
        order.tickLower,
        order.tickUpper,
        bytes32(uint256(orderIds[i]))
      );
      assertEq(positionLiquidity, order.liquidity, "book liquidity != pool position");
    }
  }

  /// Value conservation: tokens only move between actors and the pool.
  /// Combined with the zero-balance invariant, any leak to an unaccounted
  /// address (or double-take from the pool) breaks this identity.
  function invariant_ValueOnlyMovesBetweenActorsAndPool() public view {
    address[5] memory holders = [
      address(0xA11CE),
      address(0xA22CE),
      address(0xB0B),
      address(this),
      address(poolManager)
    ];
    uint256 total0;
    uint256 total1;
    for (uint256 i = 0; i < holders.length; ++i) {
      total0 += token0.balanceOf(holders[i]);
      total1 += token1.balanceOf(holders[i]);
    }
    assertEq(total0, initialTotal0, "token0 conservation violated");
    assertEq(total1, initialTotal1, "token1 conservation violated");
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

  function _deploySortedPoolTokens() private returns (V4TestERC20, V4TestERC20) {
    for (uint256 i = 0; i < 32; ++i) {
      V4TestERC20 candidate0 = new V4TestERC20("Pool Token 0", "PT0", 18);
      V4TestERC20 candidate1 = new V4TestERC20("Pool Token 1", "PT1", 18);
      if (address(candidate0) < address(candidate1)) {
        return (candidate0, candidate1);
      }
    }

    revert UnableToDeploySortedPoolPair();
  }
}
