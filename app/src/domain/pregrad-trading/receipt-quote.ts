import type { Market, MarketSide } from "@/domain/markets/types";
import type { PriceBand } from "@/domain/receipts/types";
import {
  costToBuyShares,
  createOpeningState,
  marginalPriceCents,
  sharesForBudget,
  stateAfterBuy,
} from "@/integrations/contracts/virtual-lmsr";

export const DEFAULT_RECEIPT_SLIPPAGE_BPS = 150;
export const MAX_RECEIPT_BUDGET_USD = 1_000_000;

export type ReceiptQuotePreview = {
  averagePriceCents: number;
  budgetUsd: number;
  maxCostUsd: number;
  priceBand: PriceBand;
  priceImpactCents: number;
  shares: number;
  side: MarketSide;
};

export type PlacedPregradReceipt = {
  averagePriceCents: number;
  collateralUsd: number;
  createdAt: string;
  id: string;
  marketId: string;
  marketQuestion: string;
  priceBand: PriceBand;
  receiptId: string;
  sequence?: string;
  shares: number;
  side: MarketSide;
  status: "waiting";
  transactionHash?: `0x${string}`;
};

export type ReceiptQuoteInput = {
  budgetUsd: number;
  market: Market;
  side: MarketSide;
  slippageBps?: number;
};

export function buildReceiptQuotePreview({
  budgetUsd,
  market,
  side,
  slippageBps = DEFAULT_RECEIPT_SLIPPAGE_BPS,
}: ReceiptQuoteInput): ReceiptQuotePreview {
  const normalizedBudget = normalizeReceiptBudget(budgetUsd);
  const state = createOpeningState({
    b: market.b,
    openingProbability: clampProbability(market.yesPriceCents),
  });
  const startingSidePrice = marginalPriceCents(state, side);
  const shares = sharesForBudget({
    budget: normalizedBudget,
    side,
    state,
  });
  const quotedCost = costToBuyShares({ shares, side, state });
  const afterState = stateAfterBuy({ shares, side, state });
  const endingSidePrice = marginalPriceCents(afterState, side);
  const low = Math.min(startingSidePrice, endingSidePrice);
  const high = Math.max(startingSidePrice, endingSidePrice);

  return {
    averagePriceCents: shares > 0 ? (quotedCost / shares) * 100 : startingSidePrice,
    budgetUsd: normalizedBudget,
    maxCostUsd: quotedCost * (1 + slippageBps / 10_000),
    priceBand: {
      fromProbability: low,
      toProbability: high,
    },
    priceImpactCents: Math.abs(endingSidePrice - startingSidePrice),
    shares,
    side,
  };
}

export function getReceiptAmountError(amount: string) {
  const parsed = parseReceiptAmount(amount);

  if (parsed === null) {
    return "Enter a collateral amount.";
  }

  if (parsed <= 0) {
    return "Amount must be greater than zero.";
  }

  if (parsed > MAX_RECEIPT_BUDGET_USD) {
    return "Amount is above the current receipt limit.";
  }

  return null;
}

export function parseReceiptAmount(amount: string) {
  const parsed = Number.parseFloat(amount);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function normalizeReceiptBudget(amount: number) {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("budgetUsd must be positive");
  }

  if (amount > MAX_RECEIPT_BUDGET_USD) {
    throw new Error("budgetUsd is above the receipt limit");
  }

  return amount;
}

function clampProbability(value: number) {
  return Math.min(Math.max(value, 1), 99);
}
