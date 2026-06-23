// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {PoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IPoolManager.sol";
import {TickMath} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/TickMath.sol";
import {BalanceDelta} from "@uniswap/v4-periphery/lib/v4-core/src/types/BalanceDelta.sol";
import {Currency} from "@uniswap/v4-periphery/lib/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolKey.sol";
import {
  ModifyLiquidityParams,
  SwapParams
} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolOperation.sol";
import {IV4Quoter} from "@uniswap/v4-periphery/src/interfaces/IV4Quoter.sol";
import {StateView} from "@uniswap/v4-periphery/src/lens/StateView.sol";
import {V4Quoter} from "@uniswap/v4-periphery/src/lens/V4Quoter.sol";
import {MinimalV4SwapRouter} from "../../contracts/v4/MinimalV4SwapRouter.sol";
import {V4TestERC20} from "./mocks/V4TestERC20.sol";

contract LocalV4StackSmokeTest is Test {
  error UnableToDeploySortedArcUsdcPair();

  uint24 private constant FEE = 3000;
  int24 private constant TICK_SPACING = 60;
  int24 private constant TICK_LOWER = -600;
  int24 private constant TICK_UPPER = 600;
  uint8 private constant ARC_USDC_DECIMALS = 6;
  uint8 private constant OUTCOME_DECIMALS = 18;
  uint128 private constant ARC_USDC_UNIT = 1e6;
  uint128 private constant LIQUIDITY = 100_000 * ARC_USDC_UNIT;
  uint128 private constant EXACT_INPUT = ARC_USDC_UNIT;
  uint256 private constant STARTING_RAW_BALANCE = 1_000_000_000 * uint256(ARC_USDC_UNIT);

  PoolManager private poolManager;
  StateView private stateView;
  V4Quoter private quoter;
  MinimalV4SwapRouter private router;
  V4TestERC20 private token0;
  V4TestERC20 private token1;
  PoolKey private poolKey;
  PoolId private poolId;

  function setUp() public {
    poolManager = new PoolManager(address(this));
    stateView = new StateView(IPoolManager(address(poolManager)));
    quoter = new V4Quoter(IPoolManager(address(poolManager)));
    router = new MinimalV4SwapRouter(IPoolManager(address(poolManager)));

    (token0, token1) = _deployArcUsdcStylePoolTokens();
    token0.mint(address(this), STARTING_RAW_BALANCE);
    token1.mint(address(this), STARTING_RAW_BALANCE);
    token0.approve(address(router), type(uint256).max);
    token1.approve(address(router), type(uint256).max);

    poolKey = PoolKey({
      currency0: Currency.wrap(address(token0)),
      currency1: Currency.wrap(address(token1)),
      fee: FEE,
      tickSpacing: TICK_SPACING,
      hooks: IHooks(address(0))
    });
    poolId = poolKey.toId();

    int24 initializedTick = poolManager.initialize(poolKey, TickMath.getSqrtPriceAtTick(0));
    assertEq(initializedTick, 0);
  }

  function test_DeploysLocalV4StackAndInitializesPool() public view {
    (uint160 sqrtPriceX96, int24 tick, , uint24 lpFee) = stateView.getSlot0(poolId);

    assertEq(token0.decimals(), ARC_USDC_DECIMALS);
    assertEq(token1.decimals(), OUTCOME_DECIMALS);
    assertEq(sqrtPriceX96, TickMath.getSqrtPriceAtTick(0));
    assertEq(tick, 0);
    assertEq(lpFee, FEE);
    assertEq(stateView.getLiquidity(poolId), 0);
  }

  function test_AddsLiquidityQuotesAndSwapsThroughMinimalRouter() public {
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

    (uint128 positionLiquidity, , ) = stateView.getPositionInfo(
      poolId,
      address(router),
      TICK_LOWER,
      TICK_UPPER,
      bytes32(0)
    );
    assertEq(positionLiquidity, LIQUIDITY);

    (uint256 quotedAmountOut, uint256 gasEstimate) = quoter.quoteExactInputSingle(
      IV4Quoter.QuoteExactSingleParams({
        poolKey: poolKey,
        zeroForOne: true,
        exactAmount: EXACT_INPUT,
        hookData: ""
      })
    );
    assertGt(quotedAmountOut, 0);
    assertGt(gasEstimate, 0);

    uint256 balance0Before = token0.balanceOf(address(this));
    uint256 balance1Before = token1.balanceOf(address(this));

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
    assertEq(amountOut, quotedAmountOut);
    assertEq(token0.balanceOf(address(this)), balance0Before - amountIn);
    assertEq(token1.balanceOf(address(this)), balance1Before + amountOut);

    (uint160 sqrtPriceAfter, int24 tickAfter, , ) = stateView.getSlot0(poolId);
    assertLt(sqrtPriceAfter, TickMath.getSqrtPriceAtTick(0));
    assertLt(tickAfter, 0);
  }

  function _deployArcUsdcStylePoolTokens()
    private
    returns (V4TestERC20 sortedToken0, V4TestERC20 sortedToken1)
  {
    // Arc USDC is native for gas, but v4 settlement should use the 6-decimal
    // ERC20 interface. Keep it as token0 so the exact-input swap spends USDC.
    for (uint256 i = 0; i < 32; ++i) {
      V4TestERC20 arcUsdc = new V4TestERC20("Arc USDC ERC20 Interface", "USDC", ARC_USDC_DECIMALS);
      V4TestERC20 outcome = new V4TestERC20("V4 Outcome Token", "OUT", OUTCOME_DECIMALS);

      if (address(arcUsdc) < address(outcome)) {
        return (arcUsdc, outcome);
      }
    }

    revert UnableToDeploySortedArcUsdcPair();
  }
}
