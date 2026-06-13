import type { MarketSide } from "@/domain/markets/types";

export type VirtualLmsrState = {
  b: number;
  noShares: number;
  yesShares: number;
};

export function createOpeningState({
  b,
  openingProbability,
}: {
  b: number;
  openingProbability: number;
}): VirtualLmsrState {
  assertPositiveB(b);
  assertProbability(openingProbability);

  const probability = openingProbability / 100;
  const yesShares = b * Math.log(probability / (1 - probability));

  return {
    b,
    noShares: 0,
    yesShares,
  };
}

export function costToBuyShares({
  shares,
  side,
  state,
}: {
  shares: number;
  side: MarketSide;
  state: VirtualLmsrState;
}) {
  if (shares < 0) {
    throw new Error("shares must be non-negative");
  }

  const before = lmsrCost(state);
  const afterState = stateAfterBuy({ shares, side, state });

  return lmsrCost(afterState) - before;
}

export function lmsrCost(state: VirtualLmsrState) {
  assertPositiveB(state.b);

  const yes = state.yesShares / state.b;
  const no = state.noShares / state.b;
  const max = Math.max(yes, no);

  return state.b * (max + Math.log(Math.exp(yes - max) + Math.exp(no - max)));
}

export function marginalPriceCents(state: VirtualLmsrState, side: MarketSide) {
  const yesPrice = yesProbability(state) * 100;
  return side === "yes" ? yesPrice : 100 - yesPrice;
}

export function stateAfterBuy({
  shares,
  side,
  state,
}: {
  shares: number;
  side: MarketSide;
  state: VirtualLmsrState;
}) {
  if (shares < 0) {
    throw new Error("shares must be non-negative");
  }

  return side === "yes"
    ? { ...state, yesShares: state.yesShares + shares }
    : { ...state, noShares: state.noShares + shares };
}

export function yesProbability(state: VirtualLmsrState) {
  assertPositiveB(state.b);

  const yes = Math.exp(state.yesShares / state.b);
  const no = Math.exp(state.noShares / state.b);

  return yes / (yes + no);
}

function assertPositiveB(b: number) {
  if (!Number.isFinite(b) || b <= 0) {
    throw new Error("b must be positive");
  }
}

function assertProbability(probability: number) {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 100) {
    throw new Error("openingProbability must be between 0 and 100");
  }
}
