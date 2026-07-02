import { COMPLETE_SET_MARKET_STATUS } from "./completeSetMarketStatus.js";
import { outcomeCapacityForCollateral } from "./outcomeCapacityForCollateral.js";

const WAD = 10n ** 18n;

/** One market-health finding; violations break invariants, warnings degrade UX. */
export type MarketHealthIssue = {
  readonly code:
    | "collateralShortfall"
    | "noActiveLiquidity"
    | "poolNotWhitelisted"
    | "priceSumDrift"
    | "tickBoundsUnset";
  readonly message: string;
  readonly severity: "violation" | "warning";
};

/** Point-in-time chain readings evaluated for one complete-set market. */
export type MarketHealthInput = {
  readonly collateralBalance: bigint;
  readonly collateralDecimals: number;
  readonly noDisplayPriceWad: bigint;
  readonly noSupply: bigint;
  readonly outcomeDecimals: number;
  readonly pools: readonly {
    readonly activeLiquidity: bigint;
    readonly boundsConfigured: boolean;
    readonly side: "no" | "yes";
    readonly whitelisted: boolean;
  }[];
  readonly priceSumToleranceWad: bigint;
  readonly status: number;
  readonly winningSide?: "no" | "yes";
  readonly yesDisplayPriceWad: bigint;
  readonly yesSupply: bigint;
};

/**
 * Evaluates the complete-set market health checks from chain readings: the
 * no-shortfall collateral invariant for the current lifecycle status
 * (Trading covers the larger side, Resolved covers the winning supply,
 * Cancelled covers half-value draw redemptions), plus Trading-only venue
 * checks for YES+NO price-sum drift, active pool liquidity, configured tick
 * bounds, and order-manager whitelisting. Collateral shortfalls are
 * violations; venue-availability findings are warnings.
 */
export function evaluateMarketHealth(input: MarketHealthInput): {
  readonly healthy: boolean;
  readonly issues: MarketHealthIssue[];
} {
  if (input.collateralBalance < 0n || input.yesSupply < 0n || input.noSupply < 0n) {
    throw new Error("Expected non-negative collateral balance and outcome supplies.");
  }
  if (input.priceSumToleranceWad < 0n) {
    throw new Error(`Expected a non-negative tolerance, received ${input.priceSumToleranceWad}.`);
  }

  const issues: MarketHealthIssue[] = [];
  const requiredCapacity = requiredOutcomeCapacity(input);
  const availableCapacity = outcomeCapacityForCollateral({
    collateralAmount: input.collateralBalance,
    collateralDecimals: input.collateralDecimals,
    outcomeDecimals: input.outcomeDecimals,
  });
  if (availableCapacity < requiredCapacity) {
    issues.push({
      code: "collateralShortfall",
      message:
        `Collateral escrow backs ${availableCapacity} outcome raw units but ` +
        `${requiredCapacity} are required for the current status.`,
      severity: "violation",
    });
  }

  if (input.status === COMPLETE_SET_MARKET_STATUS.trading) {
    issues.push(...evaluateTradingVenue(input));
  }
  return { healthy: !issues.some((issue) => issue.severity === "violation"), issues };
}

function requiredOutcomeCapacity(input: MarketHealthInput): bigint {
  if (input.status === COMPLETE_SET_MARKET_STATUS.trading) {
    return input.yesSupply > input.noSupply ? input.yesSupply : input.noSupply;
  }
  if (input.status === COMPLETE_SET_MARKET_STATUS.resolved) {
    if (input.winningSide === undefined) {
      throw new Error("A resolved market health check requires winningSide.");
    }
    return input.winningSide === "yes" ? input.yesSupply : input.noSupply;
  }
  if (input.status === COMPLETE_SET_MARKET_STATUS.cancelled) {
    // Draw redemptions pay half value per token, so escrow must cover half of
    // the combined supplies measured in outcome capacity.
    return (input.yesSupply + input.noSupply) / 2n;
  }
  throw new Error(`Unknown complete-set market status ${input.status}.`);
}

function evaluateTradingVenue(input: MarketHealthInput): MarketHealthIssue[] {
  const issues: MarketHealthIssue[] = [];
  if (input.yesDisplayPriceWad <= 0n || input.noDisplayPriceWad <= 0n) {
    throw new Error(
      `Expected positive display prices, received YES ${input.yesDisplayPriceWad} ` +
        `and NO ${input.noDisplayPriceWad}.`,
    );
  }
  const priceSumWad = input.yesDisplayPriceWad + input.noDisplayPriceWad;
  const drift = priceSumWad > WAD ? priceSumWad - WAD : WAD - priceSumWad;
  if (drift > input.priceSumToleranceWad) {
    issues.push({
      code: "priceSumDrift",
      message:
        `YES + NO display price sum ${priceSumWad} drifts ${drift} WAD from one full set ` +
        `(tolerance ${input.priceSumToleranceWad}); run the keeper arbitrage pass.`,
      severity: "warning",
    });
  }

  for (const pool of input.pools) {
    const label = pool.side.toUpperCase();
    if (pool.activeLiquidity <= 0n) {
      issues.push({
        code: "noActiveLiquidity",
        message: `${label} pool has no active liquidity; quotes and fills are unavailable.`,
        severity: "warning",
      });
    }
    if (!pool.boundsConfigured) {
      issues.push({
        code: "tickBoundsUnset",
        message: `${label} pool has no configured tick bounds; hooked swaps will revert.`,
        severity: "warning",
      });
    }
    if (!pool.whitelisted) {
      issues.push({
        code: "poolNotWhitelisted",
        message: `${label} pool is not whitelisted in the order manager; maker orders are blocked.`,
        severity: "warning",
      });
    }
  }
  return issues;
}
