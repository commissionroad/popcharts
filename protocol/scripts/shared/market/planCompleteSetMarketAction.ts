import { formatUnits, zeroAddress, type Address } from "viem";

import { POSTGRAD_MARKET_STATUS } from "../../../src/postgrad-market-status.js";
import { postgradMarketStatusLabel } from "./postgradMarketStatusLabel.js";
import { marketSideToContractSide, type MarketSide } from "../../../src/market-side.js";

/** On-chain lifecycle state of one CompleteSetBinaryMarket at a point in time. */
export type CompleteSetMarketSnapshot = {
  /** Decimals of the collateral token, for reporting bond amounts. */
  readonly collateralDecimals: number;
  /** Bond a non-resolver disputer must post, in collateral raw units. */
  readonly disputeBond: bigint;
  /** Bond currently escrowed for an active dispute, in collateral raw units. */
  readonly disputeBondHeld: bigint;
  /** Seconds a proposal stays disputable; zero keeps the direct-resolve path. */
  readonly disputeWindow: bigint;
  /** Account that raised the dispute, or the zero address before any. */
  readonly disputer: Address;
  /** Present only while a proposal is active (ResolutionPending or Disputed). */
  readonly proposal: { readonly deadline: bigint; readonly side: MarketSide } | undefined;
  readonly resolver: Address;
  readonly status: number;
  /** Latest block timestamp: the clock the contract's deadlines compare against. */
  readonly timestamp: bigint;
};

/** One market lifecycle action an operator can ask the admin CLI to plan. */
export type CompleteSetMarketRequest =
  | { readonly kind: "cancelMarket" }
  | { readonly kind: "resolveMarket"; readonly side: MarketSide };

/** The role a caller must hold for a planned action to do what it says. */
export type RequiredRole = {
  readonly holder: Address;
  readonly name: string;
};

/** A planned market call: what it does, who may make it, and how to verify it. */
export type CompleteSetMarketPlan = {
  readonly call: {
    readonly args: readonly [] | readonly [number];
    readonly functionName: "cancel" | "resolve";
  };
  /** Status the market must hold once the call is mined. */
  readonly expectedStatus: number;
  readonly proposedDescription: string;
  readonly requiredRole: RequiredRole;
};

const STATUS = POSTGRAD_MARKET_STATUS;

/**
 * Plans one market lifecycle call against a snapshot of the market's on-chain
 * state, refusing — before anything is broadcast — every call the contract
 * would reject, with the reason and the wait remaining where there is one.
 * Pure: the caller reads the snapshot and owns the broadcast.
 */
export function planCompleteSetMarketAction(
  snapshot: CompleteSetMarketSnapshot,
  request: CompleteSetMarketRequest,
): CompleteSetMarketPlan {
  return request.kind === "cancelMarket"
    ? planCancel(snapshot)
    : planDirectResolve(snapshot, request.side);
}

/** Renders the market's full lifecycle and dispute state for operator output. */
export function describeCompleteSetMarketState(snapshot: CompleteSetMarketSnapshot): string {
  const parts = [
    `status = ${postgradMarketStatusLabel(snapshot.status)}`,
    `resolver = ${snapshot.resolver}`,
    `dispute window = ${describeWindow(snapshot.disputeWindow)}`,
    `dispute bond = ${formatCollateral(snapshot.disputeBond, snapshot)}`,
  ];
  if (snapshot.proposal === undefined) {
    parts.push("proposal = none");
  } else {
    parts.push(`proposed side = ${label(snapshot.proposal.side)}`);
    parts.push(`dispute deadline = ${describeDeadline(snapshot.proposal.deadline, snapshot)}`);
  }
  parts.push(`disputer = ${snapshot.disputer === zeroAddress ? "none" : snapshot.disputer}`);
  parts.push(`bond held = ${formatCollateral(snapshot.disputeBondHeld, snapshot)}`);
  return parts.join(", ");
}

/** Formats a second count as its largest two nonzero units, e.g. `23h 59m`. */
function formatDuration(totalSeconds: bigint): string {
  const units: [bigint, string][] = [];
  units.push([totalSeconds / 86_400n, "d"], [(totalSeconds / 3_600n) % 24n, "h"]);
  units.push([(totalSeconds / 60n) % 60n, "m"], [totalSeconds % 60n, "s"]);
  const parts = units.filter(([value]) => value > 0n).map(([value, unit]) => `${value}${unit}`);
  return parts.length === 0 ? "0s" : parts.slice(0, 2).join(" ");
}

/** Formats a dispute window, naming the zero case for what it does. */
function describeWindow(seconds: bigint): string {
  return seconds === 0n ? "0s (disputes disabled)" : `${seconds}s (${formatDuration(seconds)})`;
}

function planDirectResolve(
  snapshot: CompleteSetMarketSnapshot,
  side: MarketSide,
): CompleteSetMarketPlan {
  requireStatus(snapshot, STATUS.trading, "resolve");
  if (snapshot.disputeWindow !== 0n) {
    throw new Error(
      `This market carries a ${describeWindow(snapshot.disputeWindow)} dispute window, so resolve() ` +
        "from Trading reverts with MarketNotDirectlyResolvable; propose the resolution instead.",
    );
  }
  return {
    call: { args: [marketSideToContractSide(side)], functionName: "resolve" },
    expectedStatus: STATUS.resolved,
    proposedDescription: `resolve(${label(side)}) -> status Resolved`,
    requiredRole: resolverRole(snapshot),
  };
}

function planCancel(snapshot: CompleteSetMarketSnapshot): CompleteSetMarketPlan {
  if (snapshot.status === STATUS.resolved || snapshot.status === STATUS.cancelled) {
    throw new Error(
      `Market status is ${postgradMarketStatusLabel(snapshot.status)}; cancel requires a ` +
        "non-terminal status (Trading, ResolutionPending, or Disputed).",
    );
  }
  // cancel() never upholds a proposed YES/NO outcome, so it refunds any escrowed
  // bond rather than forfeiting it.
  const bondNote =
    snapshot.disputeBondHeld === 0n
      ? ""
      : ` The escrowed ${formatCollateral(snapshot.disputeBondHeld, snapshot)} bond is REFUNDED to ` +
        `the disputer ${snapshot.disputer}, because a cancellation never upholds the proposal.`;
  return {
    call: { args: [], functionName: "cancel" },
    expectedStatus: STATUS.cancelled,
    proposedDescription: `cancel() -> status Cancelled (YES and NO redeem at half collateral value).${bondNote}`,
    requiredRole: resolverRole(snapshot),
  };
}

function requireStatus(
  snapshot: CompleteSetMarketSnapshot,
  expected: number,
  action: string,
): void {
  if (snapshot.status !== expected) {
    throw new Error(
      `Market status is ${postgradMarketStatusLabel(snapshot.status)}; ${action} requires ` +
        `${postgradMarketStatusLabel(expected)}.`,
    );
  }
}

function resolverRole(snapshot: CompleteSetMarketSnapshot): RequiredRole {
  return { holder: snapshot.resolver, name: "CompleteSetBinaryMarket resolver" };
}

function describeDeadline(deadline: bigint, snapshot: CompleteSetMarketSnapshot): string {
  return deadline <= snapshot.timestamp
    ? `${deadline} (closed)`
    : `${deadline} (${formatDuration(deadline - snapshot.timestamp)} remaining)`;
}

function formatCollateral(raw: bigint, snapshot: CompleteSetMarketSnapshot): string {
  return `${formatUnits(raw, snapshot.collateralDecimals)} (${raw} raw)`;
}

function label(side: MarketSide): string {
  return side.toUpperCase();
}
