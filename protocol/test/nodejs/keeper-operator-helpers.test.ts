import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { COMPLETE_SET_MARKET_STATUS } from "../../scripts/shared/market/completeSetMarketStatus.js";
import {
  detectBoundedOrderAnomalies,
  type BoundedPoolInspection,
} from "../../scripts/shared/market/detectBoundedOrderAnomalies.js";
import {
  evaluateMarketHealth,
  type MarketHealthInput,
} from "../../scripts/shared/market/evaluateMarketHealth.js";
import { outcomeCapacityForCollateral } from "../../scripts/shared/market/outcomeCapacityForCollateral.js";
import { summarizeKeeperRun } from "../../scripts/shared/market/summarizeKeeperRun.js";

const WAD = 10n ** 18n;

const MARKET = "0x1111111111111111111111111111111111111111";

function healthyPool(side: "no" | "yes"): MarketHealthInput["pools"][number] {
  return { activeLiquidity: 1_000n, boundsConfigured: true, side, whitelisted: true };
}

function tradingHealthInput(overrides: Partial<MarketHealthInput> = {}): MarketHealthInput {
  return {
    collateralBalance: 100n * WAD,
    collateralDecimals: 18,
    noDisplayPriceWad: WAD / 2n,
    noSupply: 100n * WAD,
    outcomeDecimals: 18,
    pools: [healthyPool("yes"), healthyPool("no")],
    priceSumToleranceWad: WAD / 100n,
    status: COMPLETE_SET_MARKET_STATUS.trading,
    yesDisplayPriceWad: WAD / 2n,
    yesSupply: 100n * WAD,
    ...overrides,
  };
}

function emptyPool(side: "no" | "yes"): BoundedPoolInspection {
  return {
    boundsConfigured: true,
    currentTick: 0,
    deferredExecutions: [],
    orders: [],
    side,
    whitelisted: true,
  };
}

describe("outcomeCapacityForCollateral", function () {
  it("scales up and floors down across decimal gaps", function () {
    assert.equal(
      outcomeCapacityForCollateral({
        collateralAmount: 5n * 10n ** 6n,
        collateralDecimals: 6,
        outcomeDecimals: 18,
      }),
      5n * WAD,
    );
    assert.equal(
      outcomeCapacityForCollateral({
        collateralAmount: 1_999_999_999_999n,
        collateralDecimals: 18,
        outcomeDecimals: 6,
      }),
      1n,
    );
    assert.equal(
      outcomeCapacityForCollateral({
        collateralAmount: 123n,
        collateralDecimals: 18,
        outcomeDecimals: 18,
      }),
      123n,
    );
  });

  it("rejects negative amounts and invalid decimals", function () {
    assert.throws(
      () =>
        outcomeCapacityForCollateral({
          collateralAmount: -1n,
          collateralDecimals: 6,
          outcomeDecimals: 18,
        }),
      /non-negative/,
    );
    assert.throws(
      () =>
        outcomeCapacityForCollateral({
          collateralAmount: 1n,
          collateralDecimals: 99,
          outcomeDecimals: 18,
        }),
      /collateralDecimals/,
    );
  });
});

describe("summarizeKeeperRun", function () {
  it("shapes a hold pass with no deferred work", function () {
    const summary = summarizeKeeperRun({
      arbAction: "hold",
      arbExecuted: false,
      chainId: 31337,
      deferredFound: 0,
      deferredRemaining: 0,
      deferredResolved: 0,
      market: MARKET,
      noDisplayPriceWad: WAD / 2n,
      yesDisplayPriceWad: WAD / 2n,
    });
    assert.equal(summary.arbAction, "hold");
    assert.equal(summary.arbSkippedReason, null);
    assert.equal(summary.priceSum, "1");
    assert.equal(summary.priceSumAfter, null);
    assert.equal(summary.deferredFound, 0);
  });

  it("shapes an executed arbitrage pass with drained deferred work", function () {
    const summary = summarizeKeeperRun({
      arbAction: "mintAndSell",
      arbExecuted: true,
      chainId: 31337,
      deferredFound: 2,
      deferredRemaining: 1,
      deferredResolved: 1,
      market: MARKET,
      noDisplayPriceWad: WAD / 2n + WAD / 10n,
      priceSumAfterWad: WAD,
      yesDisplayPriceWad: WAD / 2n,
    });
    assert.equal(summary.arbExecuted, true);
    assert.equal(summary.priceSumAfter, "1");
    assert.equal(summary.priceYes, "0.5");
    assert.equal(summary.priceNo, "0.6");
    assert.equal(summary.deferredRemaining, 1);
  });

  it("rejects inconsistent counts, prices, and execution flags", function () {
    const base = {
      arbAction: "hold" as const,
      arbExecuted: false,
      chainId: 31337,
      deferredFound: 1,
      deferredRemaining: 0,
      deferredResolved: 1,
      market: MARKET,
      noDisplayPriceWad: WAD / 2n,
      yesDisplayPriceWad: WAD / 2n,
    };
    assert.throws(() => summarizeKeeperRun({ ...base, chainId: 0 }), /positive chainId/);
    assert.throws(() => summarizeKeeperRun({ ...base, deferredResolved: -1 }), /deferredResolved/);
    assert.throws(() => summarizeKeeperRun({ ...base, deferredRemaining: 5 }), /reconcile/);
    assert.throws(() => summarizeKeeperRun({ ...base, yesDisplayPriceWad: 0n }), /positive/);
    assert.throws(
      () => summarizeKeeperRun({ ...base, arbAction: "mintAndSell", arbExecuted: true }),
      /priceSumAfterWad/,
    );
    assert.throws(
      () =>
        summarizeKeeperRun({
          ...base,
          arbAction: "mintAndSell",
          arbExecuted: true,
          arbSkippedReason: "poolWithoutLiquidity",
          priceSumAfterWad: WAD,
        }),
      /skip reason/,
    );
  });
});

describe("detectBoundedOrderAnomalies", function () {
  it("reports nothing for a healthy pool with fresh orders", function () {
    const anomalies = detectBoundedOrderAnomalies({
      currentBlock: 100n,
      pools: [
        {
          ...emptyPool("yes"),
          currentTick: 0,
          orders: [
            // Open but uncrossed: current tick sits inside/below the range.
            { createdAtBlock: 10n, orderId: 1, tickLower: 60, tickUpper: 120, zeroForOne: true },
          ],
        },
        emptyPool("no"),
      ],
      staleCrossedOrderBlocks: 30,
      staleDeferredExecutionBlocks: 30,
    });
    assert.deepEqual(anomalies, []);
  });

  it("flags crossed-but-unfilled orders only after the staleness window", function () {
    const pool: BoundedPoolInspection = {
      ...emptyPool("yes"),
      currentTick: 180,
      orders: [
        { createdAtBlock: 90n, orderId: 1, tickLower: 60, tickUpper: 120, zeroForOne: true },
        { createdAtBlock: 10n, orderId: 2, tickLower: 60, tickUpper: 120, zeroForOne: true },
        // Opposite direction fills below tickLower; tick 180 sits above it.
        { createdAtBlock: 10n, orderId: 3, tickLower: 60, tickUpper: 120, zeroForOne: false },
      ],
    };
    const anomalies = detectBoundedOrderAnomalies({
      currentBlock: 100n,
      pools: [pool],
      staleCrossedOrderBlocks: 30,
      staleDeferredExecutionBlocks: 30,
    });
    assert.equal(anomalies.length, 1);
    assert.equal(anomalies[0]?.code, "crossedOrderUnfilled");
    assert.match(anomalies[0]?.message ?? "", /order #2/);
  });

  it("flags stale deferred executions, unset bounds, and non-whitelisted pools", function () {
    const anomalies = detectBoundedOrderAnomalies({
      currentBlock: 100n,
      pools: [
        {
          ...emptyPool("no"),
          boundsConfigured: false,
          deferredExecutions: [
            { executionId: "0xabc", remainingOrderCount: 3n, storedAtBlock: 10n },
            { executionId: "0xdef", remainingOrderCount: 1n, storedAtBlock: 99n },
          ],
          whitelisted: false,
        },
      ],
      staleCrossedOrderBlocks: 30,
      staleDeferredExecutionBlocks: 30,
    });
    assert.deepEqual(anomalies.map((anomaly) => anomaly.code).sort(), [
      "poolNotWhitelisted",
      "staleDeferredExecution",
      "tickBoundsUnset",
    ]);
  });

  it("rejects invalid thresholds and future event blocks", function () {
    assert.throws(
      () =>
        detectBoundedOrderAnomalies({
          currentBlock: 100n,
          pools: [],
          staleCrossedOrderBlocks: 0,
          staleDeferredExecutionBlocks: 30,
        }),
      /staleCrossedOrderBlocks/,
    );
    assert.throws(
      () =>
        detectBoundedOrderAnomalies({
          currentBlock: 5n,
          pools: [
            {
              ...emptyPool("yes"),
              orders: [
                { createdAtBlock: 10n, orderId: 1, tickLower: 0, tickUpper: 60, zeroForOne: true },
              ],
            },
          ],
          staleCrossedOrderBlocks: 30,
          staleDeferredExecutionBlocks: 30,
        }),
      /order creation block/,
    );
  });
});

describe("evaluateMarketHealth", function () {
  it("passes a fully backed trading market inside the tolerance band", function () {
    const { healthy, issues } = evaluateMarketHealth(tradingHealthInput());
    assert.equal(healthy, true);
    assert.deepEqual(issues, []);
  });

  it("reports a collateral shortfall violation while trading", function () {
    const { healthy, issues } = evaluateMarketHealth(
      tradingHealthInput({ collateralBalance: 99n * WAD }),
    );
    assert.equal(healthy, false);
    assert.equal(issues[0]?.code, "collateralShortfall");
    assert.equal(issues[0]?.severity, "violation");
  });

  it("checks the winning supply after resolution and ignores the losing side", function () {
    const resolved = evaluateMarketHealth(
      tradingHealthInput({
        collateralBalance: 40n * WAD,
        noSupply: 100n * WAD,
        status: COMPLETE_SET_MARKET_STATUS.resolved,
        winningSide: "yes",
        yesSupply: 40n * WAD,
      }),
    );
    assert.equal(resolved.healthy, true);

    const shortfall = evaluateMarketHealth(
      tradingHealthInput({
        collateralBalance: 39n * WAD,
        status: COMPLETE_SET_MARKET_STATUS.resolved,
        winningSide: "yes",
        yesSupply: 40n * WAD,
      }),
    );
    assert.equal(shortfall.healthy, false);
  });

  it("covers half-value draw redemptions after cancellation", function () {
    const { healthy } = evaluateMarketHealth(
      tradingHealthInput({
        collateralBalance: 100n * WAD,
        noSupply: 100n * WAD,
        status: COMPLETE_SET_MARKET_STATUS.cancelled,
        yesSupply: 100n * WAD,
      }),
    );
    assert.equal(healthy, true);
  });

  it("warns about drift, missing liquidity, unset bounds, and delisted pools", function () {
    const { healthy, issues } = evaluateMarketHealth(
      tradingHealthInput({
        noDisplayPriceWad: WAD / 2n + WAD / 10n,
        pools: [
          { activeLiquidity: 0n, boundsConfigured: false, side: "yes", whitelisted: false },
          healthyPool("no"),
        ],
      }),
    );
    assert.equal(healthy, true);
    assert.deepEqual(issues.map((issue) => issue.code).sort(), [
      "noActiveLiquidity",
      "poolNotWhitelisted",
      "priceSumDrift",
      "tickBoundsUnset",
    ]);
    assert.ok(issues.every((issue) => issue.severity === "warning"));
  });

  it("rejects unknown statuses, missing winners, and negative inputs", function () {
    assert.throws(() => evaluateMarketHealth(tradingHealthInput({ status: 9 })), /Unknown/);
    assert.throws(
      () =>
        evaluateMarketHealth(tradingHealthInput({ status: COMPLETE_SET_MARKET_STATUS.resolved })),
      /winningSide/,
    );
    assert.throws(
      () => evaluateMarketHealth(tradingHealthInput({ collateralBalance: -1n })),
      /non-negative/,
    );
  });
});
