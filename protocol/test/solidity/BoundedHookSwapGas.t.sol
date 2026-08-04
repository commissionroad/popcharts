// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
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
import {HookMiner} from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import {BoundedPredictionHook} from "../../contracts/v4/BoundedPredictionHook.sol";
import {IBoundedPoolOrderManager} from "../../contracts/v4/interfaces/IBoundedPoolOrderManager.sol";
import {MinimalV4SwapRouter} from "../../contracts/v4/MinimalV4SwapRouter.sol";
import {PoolTickBounds} from "../../contracts/v4/PoolTickBounds.sol";
import {V4TestERC20} from "./mocks/V4TestERC20.sol";

/// Measures steady-state swap gas through the bounded hook. Deliberately touches
/// none of the hook's view/event surface so it compiles unchanged against the
/// contract with and without the per-pool swap sequence — that is what makes it
/// usable as the ADR 0025 P1 gas gate: run it on main and on the branch, and the
/// difference is the cost of carrying the sequence.
///
/// The measured swap is the third on the pool: the first two prime the pool state
/// and the hook's observation slot, so the number reflects the steady state (warm,
/// nonzero-to-nonzero SSTOREs) rather than one-off cold-slot costs that a real
/// pool pays exactly once in its lifetime.
contract BoundedHookSwapGasTest is Test {
  error UnableToDeploySortedPoolPair();

  uint24 private constant FEE = 3000;
  int24 private constant TICK_SPACING = 60;
  uint8 private constant COLLATERAL_DECIMALS = 6;
  uint8 private constant OUTCOME_DECIMALS = 18;
  uint128 private constant COLLATERAL_UNIT = 1e6;
  uint128 private constant LIQUIDITY = 100_000 * COLLATERAL_UNIT;
  uint128 private constant EXACT_INPUT = COLLATERAL_UNIT;
  uint256 private constant STARTING_RAW_BALANCE = 1_000_000_000 * uint256(COLLATERAL_UNIT);

  PoolManager private poolManager;
  MinimalV4SwapRouter private router;
  PoolTickBounds private poolTickBounds;
  BoundedPredictionHook private hook;
  PoolKey private poolKey;
  PoolId private poolId;

  function setUp() public {
    poolManager = new PoolManager(address(this));
    router = new MinimalV4SwapRouter(IPoolManager(address(poolManager)));
    poolTickBounds = new PoolTickBounds(address(this));

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
    hook = new BoundedPredictionHook{salt: salt}(
      IPoolManager(address(poolManager)),
      poolTickBounds,
      IBoundedPoolOrderManager(address(0))
    );
    assertEq(address(hook), hookAddress);

    (V4TestERC20 token0, V4TestERC20 token1) = _deploySortedPoolTokens();
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

    poolTickBounds.setPoolTickBounds(poolId, -6000, 6000);
    poolManager.initialize(poolKey, TickMath.getSqrtPriceAtTick(0));

    (BalanceDelta liquidityDelta, ) = router.modifyLiquidity(
      poolKey,
      ModifyLiquidityParams({
        tickLower: -600,
        tickUpper: 600,
        liquidityDelta: int256(uint256(LIQUIDITY)),
        salt: bytes32(0)
      }),
      ""
    );
    assertTrue(liquidityDelta.amount0() < 0);
  }

  function test_GasSteadyStateSwapThroughHook() public {
    // Two priming swaps in opposite directions: warm every storage slot the
    // steady state touches and finish near the starting price.
    _swap(true);
    _swap(false);

    uint256 gasBefore = gasleft();
    _swap(true);
    uint256 gasUsed = gasBefore - gasleft();

    emit log_named_uint("steady-state swap gas through bounded hook", gasUsed);
    // Regression bound: measured 65,127 with the swap sequence (64,574
    // without — ADR 0025 P1). Tight enough that adding a fresh storage write
    // per swap (~20k cold, ~5k warm-nonzero) fails loudly, loose enough to
    // absorb compiler/dependency drift. Re-baseline deliberately if the hook
    // legitimately grows.
    assertLt(gasUsed, 80_000);
  }

  function _swap(bool zeroForOne) private {
    router.swap(
      poolKey,
      SwapParams({
        zeroForOne: zeroForOne,
        amountSpecified: -int256(uint256(EXACT_INPUT)),
        sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
      }),
      address(this),
      ""
    );
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
