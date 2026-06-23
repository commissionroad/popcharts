// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IPoolManager.sol";
import {CustomRevert} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/CustomRevert.sol";
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
import {IBoundedPoolOrderManager} from "../../contracts/v4/interfaces/IBoundedPoolOrderManager.sol";
import {MinimalV4SwapRouter} from "../../contracts/v4/MinimalV4SwapRouter.sol";
import {PoolTickBounds} from "../../contracts/v4/PoolTickBounds.sol";
import {V4TestERC20} from "./mocks/V4TestERC20.sol";

contract HookSkeletonAndPriceBoundsTest is Test {
  error UnableToDeploySortedPoolPair();

  uint24 private constant FEE = 3000;
  int24 private constant TICK_SPACING = 60;
  int24 private constant TICK_LOWER = -600;
  int24 private constant TICK_UPPER = 600;
  uint8 private constant COLLATERAL_DECIMALS = 6;
  uint8 private constant OUTCOME_DECIMALS = 18;
  uint128 private constant COLLATERAL_UNIT = 1e6;
  uint128 private constant LIQUIDITY = 100_000 * COLLATERAL_UNIT;
  uint128 private constant EXACT_INPUT = COLLATERAL_UNIT;
  uint256 private constant STARTING_RAW_BALANCE = 1_000_000_000 * uint256(COLLATERAL_UNIT);

  PoolManager private poolManager;
  StateView private stateView;
  MinimalV4SwapRouter private router;
  PoolTickBounds private poolTickBounds;
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
    hook = _deployHookAtPermissionedAddress();

    (token0, token1) = _deploySortedPoolTokens();
    token0.mint(address(this), STARTING_RAW_BALANCE);
    token1.mint(address(this), STARTING_RAW_BALANCE);
    token0.approve(address(router), type(uint256).max);
    token1.approve(address(router), type(uint256).max);

    poolKey = PoolKey({
      currency0: Currency.wrap(address(token0)),
      currency1: Currency.wrap(address(token1)),
      fee: FEE,
      tickSpacing: TICK_SPACING,
      hooks: IHooks(address(hook))
    });
    poolId = poolKey.toId();
  }

  function test_DeploysHookAtPermissionedAddressAndInitializesPool() public {
    assertEq(uint160(address(hook)) & Hooks.ALL_HOOK_MASK, hook.hookPermissionFlags());
    assertEq(address(hook.poolManager()), address(poolManager));
    assertEq(address(hook.poolTickBounds()), address(poolTickBounds));

    Hooks.Permissions memory permissions = hook.getHookPermissions();
    assertTrue(permissions.beforeSwap);
    assertTrue(permissions.afterSwap);
    assertFalse(permissions.afterSwapReturnDelta);

    poolTickBounds.setPoolTickBounds(poolId, -120, 120);
    int24 initializedTick = poolManager.initialize(poolKey, TickMath.getSqrtPriceAtTick(0));
    assertEq(initializedTick, 0);

    (uint160 sqrtPriceX96, int24 tick, , uint24 lpFee) = stateView.getSlot0(poolId);
    assertEq(sqrtPriceX96, TickMath.getSqrtPriceAtTick(0));
    assertEq(tick, 0);
    assertEq(lpFee, FEE);
  }

  function test_SwapInsideBoundsSucceedsAndRecordsBeforeAfterTicks() public {
    _initializeBoundedPool(-120, 120);
    _addLiquidity();

    BalanceDelta swapDelta = router.swap(
      poolKey,
      SwapParams({
        zeroForOne: true,
        amountSpecified: -int256(uint256(EXACT_INPUT)),
        sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
      }),
      address(this),
      ""
    );

    uint256 amountIn = uint256(uint128(-swapDelta.amount0()));
    uint256 amountOut = uint256(uint128(swapDelta.amount1()));
    assertEq(amountIn, EXACT_INPUT);
    assertGt(amountOut, 0);

    (bool observed, int24 beforeTick, int24 afterTick) = hook.lastSwapTickObservation(poolId);
    (, int24 currentTick, , ) = stateView.getSlot0(poolId);

    assertTrue(observed);
    assertEq(beforeTick, 0);
    assertEq(afterTick, currentTick);
    assertLt(afterTick, 0);
    assertGe(afterTick, -120);
  }

  function test_SwapBeyondBoundsReverts() public {
    _initializeBoundedPool(0, 1);
    _addLiquidity();

    vm.expectRevert(
      abi.encodeWithSelector(
        CustomRevert.WrappedError.selector,
        address(hook),
        BoundedPredictionHook.afterSwap.selector,
        abi.encodeWithSelector(PoolTickBounds.PoolTickOutOfBounds.selector, poolId, -1, 0, 1),
        abi.encodeWithSelector(Hooks.HookCallFailed.selector)
      )
    );
    router.swap(
      poolKey,
      SwapParams({
        zeroForOne: true,
        amountSpecified: -int256(uint256(EXACT_INPUT)),
        sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
      }),
      address(this),
      ""
    );
  }

  function test_ValidatorRejectsUnsetInvalidAndOutOfBoundsTicks() public {
    vm.expectRevert(abi.encodeWithSelector(PoolTickBounds.PoolTickBoundsUnset.selector, poolId));
    poolTickBounds.validatePoolTick(poolId, 0);

    vm.expectRevert(abi.encodeWithSelector(PoolTickBounds.InvalidTickBounds.selector, 1, 1));
    poolTickBounds.setPoolTickBounds(poolId, 1, 1);

    poolTickBounds.setPoolTickBounds(poolId, 0, 1);
    vm.expectRevert(
      abi.encodeWithSelector(PoolTickBounds.PoolTickOutOfBounds.selector, poolId, -1, 0, 1)
    );
    poolTickBounds.validatePoolTick(poolId, -1);
  }

  function _deployHookAtPermissionedAddress() private returns (BoundedPredictionHook deployedHook) {
    bytes memory constructorArgs = abi.encode(
      IPoolManager(address(poolManager)),
      poolTickBounds,
      IBoundedPoolOrderManager(address(0))
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
      IBoundedPoolOrderManager(address(0))
    );
    assertEq(address(deployedHook), hookAddress);
  }

  function _initializeBoundedPool(int24 lowerTick, int24 upperTick) private {
    poolTickBounds.setPoolTickBounds(poolId, lowerTick, upperTick);
    int24 initializedTick = poolManager.initialize(poolKey, TickMath.getSqrtPriceAtTick(0));
    assertEq(initializedTick, 0);
  }

  function _addLiquidity() private {
    (BalanceDelta liquidityDelta, ) = router.modifyLiquidity(
      poolKey,
      ModifyLiquidityParams({
        tickLower: TICK_LOWER,
        tickUpper: TICK_UPPER,
        liquidityDelta: int256(uint256(LIQUIDITY)),
        salt: bytes32(0)
      }),
      ""
    );

    assertTrue(liquidityDelta.amount0() < 0);
    assertTrue(liquidityDelta.amount1() < 0);
    assertEq(stateView.getLiquidity(poolId), LIQUIDITY);
  }

  function _deploySortedPoolTokens()
    private
    returns (V4TestERC20 sortedToken0, V4TestERC20 sortedToken1)
  {
    for (uint256 i = 0; i < 32; ++i) {
      V4TestERC20 collateral = new V4TestERC20(
        "Six Decimal Collateral",
        "COL",
        COLLATERAL_DECIMALS
      );
      V4TestERC20 outcome = new V4TestERC20("Outcome Token", "OUT", OUTCOME_DECIMALS);

      if (address(collateral) < address(outcome)) {
        return (collateral, outcome);
      }
    }

    revert UnableToDeploySortedPoolPair();
  }
}
