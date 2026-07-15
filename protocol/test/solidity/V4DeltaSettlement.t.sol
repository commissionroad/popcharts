// SPDX-License-Identifier: MIT
// solhint-disable compiler-version
pragma solidity ^0.8.26;

// solhint-disable use-natspec

import {Test} from "forge-std/Test.sol";
import {Currency, CurrencyLibrary} from "@uniswap/v4-periphery/lib/v4-core/src/types/Currency.sol";
import {V4DeltaSettlement} from "../../contracts/v4/libraries/V4DeltaSettlement.sol";
import {V4DeltaSettlementHarness} from "./harnesses/V4DeltaSettlementHarness.sol";
import {CallJournal} from "./mocks/CallJournal.sol";
import {PoolManagerRecordingMock} from "./mocks/PoolManagerRecordingMock.sol";
import {TokenPullerRecordingMock} from "./mocks/TokenPullerRecordingMock.sol";

contract V4DeltaSettlementTest is Test {
  using CurrencyLibrary for Currency;

  address private constant TOKEN0 = address(0x1000);
  address private constant TOKEN1 = address(0x2000);
  address private constant OWNER = address(0xA11CE);
  address private constant RECIPIENT = address(0xB0B);

  V4DeltaSettlementHarness private harness;
  CallJournal private journal;
  PoolManagerRecordingMock private poolManager;
  TokenPullerRecordingMock private tokenPuller;
  Currency private currency0;
  Currency private currency1;

  function setUp() public {
    harness = new V4DeltaSettlementHarness();
    journal = new CallJournal();
    poolManager = new PoolManagerRecordingMock(journal);
    tokenPuller = new TokenPullerRecordingMock(journal);
    currency0 = Currency.wrap(TOKEN0);
    currency1 = Currency.wrap(TOKEN1);
  }

  function test_SettleOrderInputZeroForOnePullsCurrency0InCallOrder() public {
    uint256 amountIn = harness.settleOrderInput(
      address(poolManager),
      address(tokenPuller),
      currency0,
      currency1,
      OWNER,
      true,
      500,
      -500,
      0
    );

    assertEq(amountIn, 500);
    _assertJournal("sync", "pull", "settle");
    assertEq(tokenPuller.callCount(), 1);
    (address from, address to, uint160 amount, address token) = tokenPuller.lastCall();
    assertEq(from, OWNER);
    assertEq(to, address(poolManager));
    assertEq(amount, 500);
    assertEq(token, TOKEN0);
  }

  function test_SettleOrderInputOneForZeroPullsCurrency1() public {
    uint256 amountIn = harness.settleOrderInput(
      address(poolManager),
      address(tokenPuller),
      currency0,
      currency1,
      OWNER,
      false,
      500,
      0,
      -500
    );

    assertEq(amountIn, 500);
    _assertJournal("sync", "pull", "settle");
    (address from, address to, uint160 amount, address token) = tokenPuller.lastCall();
    assertEq(from, OWNER);
    assertEq(to, address(poolManager));
    assertEq(amount, 500);
    assertEq(token, TOKEN1);
  }

  function test_SettleOrderInputRejectsWrongSignDeltas() public {
    _expectUnexpectedDelta(0, 0);
    harness.settleOrderInput(
      address(poolManager),
      address(tokenPuller),
      currency0,
      currency1,
      OWNER,
      true,
      500,
      0,
      0
    );

    _expectUnexpectedDelta(1, 0);
    harness.settleOrderInput(
      address(poolManager),
      address(tokenPuller),
      currency0,
      currency1,
      OWNER,
      true,
      500,
      1,
      0
    );

    _expectUnexpectedDelta(-1, 1);
    harness.settleOrderInput(
      address(poolManager),
      address(tokenPuller),
      currency0,
      currency1,
      OWNER,
      true,
      500,
      -1,
      1
    );
  }

  function test_SettleOrderInputRejectsAmountAboveMaximum() public {
    vm.expectRevert(
      abi.encodeWithSelector(
        V4DeltaSettlement.AmountExceedsMaximum.selector,
        uint256(500),
        uint256(499)
      )
    );
    harness.settleOrderInput(
      address(poolManager),
      address(tokenPuller),
      currency0,
      currency1,
      OWNER,
      true,
      499,
      -500,
      0
    );
  }

  function test_TakePositiveDeltasTakesBothCurrencies() public {
    (uint256 amount0, uint256 amount1) = harness.takePositiveDeltas(
      address(poolManager),
      currency0,
      currency1,
      RECIPIENT,
      3,
      7
    );

    assertEq(amount0, 3);
    assertEq(amount1, 7);
    assertEq(journal.labelCount(), 2);
    _assertLabel(0, "take");
    _assertLabel(1, "take");
    _assertTake(0, currency0, RECIPIENT, 3);
    _assertTake(1, currency1, RECIPIENT, 7);
  }

  function test_TakePositiveDeltasSkipsZeroCurrency() public {
    (uint256 amount0, uint256 amount1) = harness.takePositiveDeltas(
      address(poolManager),
      currency0,
      currency1,
      RECIPIENT,
      0,
      7
    );

    assertEq(amount0, 0);
    assertEq(amount1, 7);
    assertEq(journal.labelCount(), 1);
    _assertLabel(0, "take");
    _assertTake(0, currency1, RECIPIENT, 7);
  }

  function test_TakePositiveDeltasRejectsNegativeComponent() public {
    _expectUnexpectedDelta(-1, 0);
    harness.takePositiveDeltas(address(poolManager), currency0, currency1, RECIPIENT, -1, 0);
  }

  function test_TakePositiveNetDeltasTakesPositiveNets() public {
    (uint256 amount0, uint256 amount1) = harness.takePositiveNetDeltas(
      address(poolManager),
      currency0,
      currency1,
      RECIPIENT,
      10,
      -4,
      -6,
      5
    );

    assertEq(amount0, 4);
    assertEq(amount1, 1);
    _assertTake(0, currency0, RECIPIENT, 4);
    _assertTake(1, currency1, RECIPIENT, 1);
  }

  function test_TakePositiveNetDeltasRejectsNegativeNet() public {
    _expectUnexpectedDelta(-1, 0);
    harness.takePositiveNetDeltas(
      address(poolManager),
      currency0,
      currency1,
      RECIPIENT,
      2,
      0,
      -3,
      0
    );
  }

  function test_TakePositiveNetDeltasSkipsZeroNet() public {
    (uint256 amount0, uint256 amount1) = harness.takePositiveNetDeltas(
      address(poolManager),
      currency0,
      currency1,
      RECIPIENT,
      6,
      -5,
      -6,
      5
    );

    assertEq(amount0, 0);
    assertEq(amount1, 0);
    assertEq(journal.labelCount(), 0);
    assertEq(poolManager.takeCount(), 0);
  }

  function test_SettleRejectsNativeCurrency() public {
    vm.expectRevert(V4DeltaSettlement.NativeCurrencyUnsupported.selector);
    harness.settle(address(poolManager), address(tokenPuller), Currency.wrap(address(0)), OWNER, 1);
  }

  function test_SettleRejectsAmountAbovePullType() public {
    uint256 amount = uint256(type(uint160).max) + 1;
    vm.expectRevert(abi.encodeWithSelector(V4DeltaSettlement.PullAmountTooLarge.selector, amount));
    harness.settle(address(poolManager), address(tokenPuller), currency0, OWNER, amount);
  }

  function test_PositiveDeltaAmountsReturnTheirComponents() public view {
    assertEq(harness.positiveDeltaAmount0(3, 7), 3);
    assertEq(harness.positiveDeltaAmount1(3, 7), 7);
  }

  function test_PositiveDeltaAmount0RejectsEitherNegativeComponent() public {
    _expectUnexpectedDelta(-1, 0);
    harness.positiveDeltaAmount0(-1, 0);

    _expectUnexpectedDelta(0, -1);
    harness.positiveDeltaAmount0(0, -1);
  }

  function test_PositiveDeltaAmount1RejectsEitherNegativeComponent() public {
    _expectUnexpectedDelta(-1, 0);
    harness.positiveDeltaAmount1(-1, 0);

    _expectUnexpectedDelta(0, -1);
    harness.positiveDeltaAmount1(0, -1);
  }

  function test_ValidatePartialAddDeltaAcceptsInputDebtOrZero() public view {
    harness.validatePartialAddDelta(true, -5, 0);
    harness.validatePartialAddDelta(true, 0, 0);
    harness.validatePartialAddDelta(false, 0, -5);
    harness.validatePartialAddDelta(false, 0, 0);
  }

  function test_ValidatePartialAddDeltaRejectsInvalidZeroForOneShapes() public {
    _expectUnexpectedDelta(1, 0);
    harness.validatePartialAddDelta(true, 1, 0);

    _expectUnexpectedDelta(0, 1);
    harness.validatePartialAddDelta(true, 0, 1);

    _expectUnexpectedDelta(0, -1);
    harness.validatePartialAddDelta(true, 0, -1);
  }

  function test_ValidatePartialAddDeltaRejectsInvalidOneForZeroShapes() public {
    _expectUnexpectedDelta(0, 1);
    harness.validatePartialAddDelta(false, 0, 1);

    _expectUnexpectedDelta(1, 0);
    harness.validatePartialAddDelta(false, 1, 0);

    _expectUnexpectedDelta(-1, 0);
    harness.validatePartialAddDelta(false, -1, 0);
  }

  function _expectUnexpectedDelta(int128 amount0, int128 amount1) private {
    vm.expectRevert(
      abi.encodeWithSelector(V4DeltaSettlement.UnexpectedNegativeDelta.selector, amount0, amount1)
    );
  }

  function _assertJournal(
    string memory first,
    string memory second,
    string memory third
  ) private view {
    assertEq(journal.labelCount(), 3);
    _assertLabel(0, first);
    _assertLabel(1, second);
    _assertLabel(2, third);
  }

  function _assertLabel(uint256 index, string memory expected) private view {
    assertEq(journal.labelAt(index), expected);
  }

  function _assertTake(
    uint256 index,
    Currency expectedCurrency,
    address expectedRecipient,
    uint256 expectedAmount
  ) private view {
    (Currency takenCurrency, address recipient, uint256 amount) = poolManager.takeAt(index);
    assertEq(Currency.unwrap(takenCurrency), Currency.unwrap(expectedCurrency));
    assertEq(recipient, expectedRecipient);
    assertEq(amount, expectedAmount);
  }
}
