// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {PoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/PoolManager.sol";
import {IHooks} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IHooks.sol";
import {IPoolManager} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IPoolManager.sol";
import {IProtocolFees} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/IProtocolFees.sol";
import {IUnlockCallback} from "@uniswap/v4-periphery/lib/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {TickMath} from "@uniswap/v4-periphery/lib/v4-core/src/libraries/TickMath.sol";
import {Currency} from "@uniswap/v4-periphery/lib/v4-core/src/types/Currency.sol";
import {PoolId} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolId.sol";
import {PoolKey} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolKey.sol";
import {
  ModifyLiquidityParams,
  SwapParams
} from "@uniswap/v4-periphery/lib/v4-core/src/types/PoolOperation.sol";
import {StateView} from "@uniswap/v4-periphery/src/lens/StateView.sol";
import {MinimalV4SwapRouter} from "../../contracts/v4/MinimalV4SwapRouter.sol";
import {
  ICompleteSetMergeMarket,
  PostgradFeeController
} from "../../contracts/v4/PostgradFeeController.sol";
import {V4TestERC20} from "./mocks/V4TestERC20.sol";

/// Venue-side controller coverage against a real pool manager: install,
/// arming (packed-fee validation and read-back), input-side fee accrual from
/// real swaps in both directions, and the evented sweep. The merge policy
/// runs against the real complete-set market in
/// PostgradFeeControllerMerge.t.sol — that market pins solidity ^0.8.28 while
/// the pool manager's closure pins 0.8.26 exactly, so one suite cannot hold
/// both.
contract PostgradFeeControllerVenueTest is Test {
  error UnableToDeploySortedPoolTokens();

  uint24 private constant LP_FEE = 3000;
  int24 private constant TICK_SPACING = 60;
  int24 private constant TICK_LOWER = -600;
  int24 private constant TICK_UPPER = 600;
  uint8 private constant COLLATERAL_DECIMALS = 6;
  uint8 private constant OUTCOME_DECIMALS = 18;
  uint128 private constant COLLATERAL_UNIT = 1e6;
  uint128 private constant LIQUIDITY = 100_000 * COLLATERAL_UNIT;
  // Raw exact-input small enough to stay within one tick-range step, so the
  // accrual assertion can use the single-step protocol-fee formula.
  uint128 private constant EXACT_INPUT = COLLATERAL_UNIT;
  uint256 private constant STARTING_RAW_BALANCE = 1_000_000_000 * uint256(COLLATERAL_UNIT);
  uint256 private constant PIPS_DENOMINATOR = 1_000_000;

  address private treasury = makeAddr("treasury");
  address private stranger = makeAddr("stranger");

  PoolManager private poolManager;
  StateView private stateView;
  MinimalV4SwapRouter private router;
  PostgradFeeController private controller;
  V4TestERC20 private collateralToken;
  V4TestERC20 private outcomeToken;
  PoolKey private poolKey;
  PoolId private poolId;

  function setUp() public {
    poolManager = new PoolManager(address(this));
    stateView = new StateView(IPoolManager(address(poolManager)));
    router = new MinimalV4SwapRouter(IPoolManager(address(poolManager)));
    controller = new PostgradFeeController(IProtocolFees(address(poolManager)), address(this));
    poolManager.setProtocolFeeController(address(controller));

    (collateralToken, outcomeToken) = _deploySortedPoolTokens();
    collateralToken.mint(address(this), STARTING_RAW_BALANCE);
    outcomeToken.mint(address(this), STARTING_RAW_BALANCE);
    collateralToken.approve(address(router), type(uint256).max);
    outcomeToken.approve(address(router), type(uint256).max);

    poolKey = PoolKey({
      currency0: Currency.wrap(address(collateralToken)),
      currency1: Currency.wrap(address(outcomeToken)),
      fee: LP_FEE,
      tickSpacing: TICK_SPACING,
      hooks: IHooks(address(0))
    });
    poolId = poolKey.toId();
    poolManager.initialize(poolKey, TickMath.getSqrtPriceAtTick(0));

    router.modifyLiquidity(
      poolKey,
      ModifyLiquidityParams({
        tickLower: TICK_LOWER,
        tickUpper: TICK_UPPER,
        liquidityDelta: int256(uint256(LIQUIDITY)),
        salt: bytes32(0)
      }),
      ""
    );
  }

  function test_ConstructorRejectsZeroPoolManager() public {
    vm.expectRevert(PostgradFeeController.InvalidPoolManager.selector);
    new PostgradFeeController(IProtocolFees(address(0)), address(this));
  }

  function test_VenueRecognizesInstalledController() public view {
    assertEq(poolManager.protocolFeeController(), address(controller));
    assertEq(address(controller.poolManager()), address(poolManager));
    assertEq(controller.owner(), address(this));
  }

  function test_SymmetricFeeMatchesDocumentedPacking() public view {
    // The docs/fee-model.md packing, derived independently of the contract.
    assertEq(controller.SYMMETRIC_PROTOCOL_FEE(), uint24(1000) | (uint24(1000) << 12));
    assertEq(controller.SYMMETRIC_PROTOCOL_FEE(), 4_097_000);
  }

  function test_ArmPoolProtocolFeeSetsPackedFeeAndEmits() public {
    uint24 fee = controller.SYMMETRIC_PROTOCOL_FEE();

    vm.expectEmit(true, true, true, true, address(controller));
    emit PostgradFeeController.PoolProtocolFeeArmed(poolId, fee);
    controller.armPoolProtocolFee(poolKey, fee);

    (, , uint24 armedFee, uint24 lpFee) = stateView.getSlot0(poolId);
    assertEq(armedFee, fee);
    assertEq(lpFee, LP_FEE);
  }

  function test_ArmPoolProtocolFeeBatchArmsEveryPool() public {
    PoolKey memory secondKey = PoolKey({
      currency0: poolKey.currency0,
      currency1: poolKey.currency1,
      fee: 500,
      tickSpacing: 10,
      hooks: IHooks(address(0))
    });
    poolManager.initialize(secondKey, TickMath.getSqrtPriceAtTick(0));

    PoolKey[] memory keys = new PoolKey[](2);
    keys[0] = poolKey;
    keys[1] = secondKey;
    controller.armPoolProtocolFeeBatch(keys, controller.SYMMETRIC_PROTOCOL_FEE());

    (, , uint24 firstFee, ) = stateView.getSlot0(poolId);
    (, , uint24 secondFee, ) = stateView.getSlot0(secondKey.toId());
    assertEq(firstFee, controller.SYMMETRIC_PROTOCOL_FEE());
    assertEq(secondFee, controller.SYMMETRIC_PROTOCOL_FEE());
  }

  function test_ArmPoolProtocolFeeRejectsEitherDirectionOverCap() public {
    uint24 zeroForOneOverCap = 1001;
    vm.expectRevert(
      abi.encodeWithSelector(
        PostgradFeeController.ProtocolFeeExceedsDirectionCap.selector,
        zeroForOneOverCap,
        uint16(1000)
      )
    );
    controller.armPoolProtocolFee(poolKey, zeroForOneOverCap);

    uint24 oneForZeroOverCap = (uint24(1001) << 12) | uint24(1000);
    vm.expectRevert(
      abi.encodeWithSelector(
        PostgradFeeController.ProtocolFeeExceedsDirectionCap.selector,
        oneForZeroOverCap,
        uint16(1000)
      )
    );
    controller.armPoolProtocolFee(poolKey, oneForZeroOverCap);
  }

  function test_ArmPoolProtocolFeeBatchRejectsEmptyBatch() public {
    // Hoisted so the constant's staticcall does not consume the expectRevert.
    uint24 fee = controller.SYMMETRIC_PROTOCOL_FEE();

    vm.expectRevert(PostgradFeeController.EmptyPoolKeyBatch.selector);
    controller.armPoolProtocolFeeBatch(new PoolKey[](0), fee);
  }

  function test_ArmPoolProtocolFeeRequiresVenueInstall() public {
    PostgradFeeController uninstalled = new PostgradFeeController(
      IProtocolFees(address(poolManager)),
      address(this)
    );
    uint24 fee = uninstalled.SYMMETRIC_PROTOCOL_FEE();

    vm.expectRevert(IProtocolFees.InvalidCaller.selector);
    uninstalled.armPoolProtocolFee(poolKey, fee);
  }

  function test_SwapAccruesInputSideProtocolFeeBeforeLpFee() public {
    controller.armPoolProtocolFee(poolKey, controller.SYMMETRIC_PROTOCOL_FEE());

    _swapExactInput(true);

    // The venue charges the protocol fee on the full input before the LP fee:
    // one directional slice at 1000 pips of the whole EXACT_INPUT, so the
    // accrual is 0.1% of input, not 0.1% of the post-LP-fee remainder.
    uint256 expectedAccrual = (uint256(EXACT_INPUT) * 1000) / PIPS_DENOMINATOR;
    assertEq(poolManager.protocolFeesAccrued(poolKey.currency0), expectedAccrual);
    assertEq(poolManager.protocolFeesAccrued(poolKey.currency1), 0);
  }

  function test_SellSwapAccruesOutcomeCurrency() public {
    controller.armPoolProtocolFee(poolKey, controller.SYMMETRIC_PROTOCOL_FEE());

    // Outcome-token input (a sell): the fee accrues in the outcome currency,
    // which is the docs/fee-model.md outcome-token trap this controller's
    // merge policy exists for.
    _swapExactInput(false);

    uint256 expectedAccrual = (uint256(EXACT_INPUT) * 1000) / PIPS_DENOMINATOR;
    assertEq(poolManager.protocolFeesAccrued(poolKey.currency1), expectedAccrual);
    assertEq(poolManager.protocolFeesAccrued(poolKey.currency0), 0);
  }

  function test_SweepTransfersFullAccrualEmitsAndZeroes() public {
    controller.armPoolProtocolFee(poolKey, controller.SYMMETRIC_PROTOCOL_FEE());
    _swapExactInput(true);
    uint256 accrued = poolManager.protocolFeesAccrued(poolKey.currency0);
    assertGt(accrued, 0);

    vm.expectEmit(true, true, true, true, address(controller));
    emit PostgradFeeController.ProtocolFeesSwept(poolKey.currency0, treasury, accrued);
    uint256 swept = controller.sweepProtocolFees(poolKey.currency0, treasury);

    assertEq(swept, accrued);
    assertEq(collateralToken.balanceOf(treasury), accrued);
    assertEq(poolManager.protocolFeesAccrued(poolKey.currency0), 0);
  }

  function test_SweepOutcomeFeesToControllerForMerging() public {
    controller.armPoolProtocolFee(poolKey, controller.SYMMETRIC_PROTOCOL_FEE());
    _swapExactInput(false);
    uint256 accrued = poolManager.protocolFeesAccrued(poolKey.currency1);

    controller.sweepProtocolFees(poolKey.currency1, address(controller));

    assertEq(outcomeToken.balanceOf(address(controller)), accrued);
    assertEq(poolManager.protocolFeesAccrued(poolKey.currency1), 0);
  }

  function test_SweepRevertsWhenNothingAccrued() public {
    vm.expectRevert(
      abi.encodeWithSelector(PostgradFeeController.NoFeesToSweep.selector, poolKey.currency0)
    );
    controller.sweepProtocolFees(poolKey.currency0, treasury);
  }

  function test_SweepRejectsZeroRecipient() public {
    vm.expectRevert(PostgradFeeController.InvalidFeeRecipient.selector);
    controller.sweepProtocolFees(poolKey.currency0, address(0));
  }

  function test_SweepInsideUnlockRevertsWhileCurrencySynced() public {
    // Pins the own-transaction rule the sweep natspec and docs/fee-model.md
    // state: with the fee currency mid-sync inside an unlock cycle, the venue
    // rejects the sweep, so it can never run inside an unlock/settle flow.
    SyncedSweepDriver driver = new SyncedSweepDriver(IPoolManager(address(poolManager)));
    poolManager.setProtocolFeeController(address(driver.controller()));

    vm.expectRevert(IProtocolFees.ProtocolFeeCurrencySynced.selector);
    driver.sweepWhileSynced(poolKey.currency0, treasury);
  }

  function test_OnlyOwnerGatesEveryMutatingFunction() public {
    PoolKey[] memory keys = new PoolKey[](1);
    keys[0] = poolKey;
    bytes memory unauthorized = abi.encodeWithSelector(
      Ownable.OwnableUnauthorizedAccount.selector,
      stranger
    );

    vm.startPrank(stranger);
    vm.expectRevert(unauthorized);
    controller.armPoolProtocolFee(poolKey, 1);
    vm.expectRevert(unauthorized);
    controller.armPoolProtocolFeeBatch(keys, 1);
    vm.expectRevert(unauthorized);
    controller.sweepProtocolFees(poolKey.currency0, treasury);
    vm.expectRevert(unauthorized);
    controller.mergeOutcomeFees(ICompleteSetMergeMarket(address(this)));
    vm.expectRevert(unauthorized);
    controller.withdrawFeeTokens(collateralToken, treasury, 1);
    vm.stopPrank();
  }

  function _swapExactInput(bool zeroForOne) private {
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

  // 6-decimal collateral below 18-decimal outcome mirrors the live venue
  // shape; sorting by address keeps the pool key canonical.
  function _deploySortedPoolTokens()
    private
    returns (V4TestERC20 sortedCollateral, V4TestERC20 sortedOutcome)
  {
    for (uint256 i = 0; i < 32; ++i) {
      V4TestERC20 collateral = new V4TestERC20("Test Collateral", "COLL", COLLATERAL_DECIMALS);
      V4TestERC20 outcome = new V4TestERC20("Test Outcome", "OUT", OUTCOME_DECIMALS);

      if (address(collateral) < address(outcome)) {
        return (collateral, outcome);
      }
    }

    revert UnableToDeploySortedPoolTokens();
  }
}

/// Test-only reproduction of the forbidden ops shape: a sweep issued while
/// the fee currency is mid-sync inside an unlock cycle. Owns (and installs
/// via the test) its own controller so the venue's synced-currency guard,
/// not its caller check, is what fires.
contract SyncedSweepDriver is IUnlockCallback {
  IPoolManager private poolManager;
  PostgradFeeController public controller;

  constructor(IPoolManager poolManager_) {
    poolManager = poolManager_;
    controller = new PostgradFeeController(IProtocolFees(address(poolManager_)), address(this));
  }

  function sweepWhileSynced(Currency currency, address recipient) external {
    poolManager.unlock(abi.encode(currency, recipient));
  }

  function unlockCallback(bytes calldata data) external returns (bytes memory) {
    (Currency currency, address recipient) = abi.decode(data, (Currency, address));
    poolManager.sync(currency);
    controller.sweepProtocolFees(currency, recipient);
    return "";
  }
}
