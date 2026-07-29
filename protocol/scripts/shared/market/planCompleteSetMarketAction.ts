import { formatUnits, zeroAddress, type Address } from "viem";

import { POSTGRAD_MARKET_STATUS } from "#src/postgrad-market-status.js";
import { postgradMarketStatusLabel } from "./postgradMarketStatusLabel.js";
import { marketSideToContractSide, type MarketSide } from "#src/market-side.js";

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
  /** Earliest timestamp each side may be proposed or resolved (pregrad gates). */
  readonly notBefore: { readonly no: bigint; readonly yes: bigint };
  /** Market owner — the destination of a forfeited bond. */
  readonly owner: Address;
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
  | { readonly kind: "disputeMarket" }
  | { readonly kind: "finalizeResolution" }
  | { readonly kind: "proposeResolution"; readonly side: MarketSide }
  | { readonly kind: "resolveMarket"; readonly side: MarketSide }
  | { readonly kind: "settleDispute"; readonly side: MarketSide };

/** The role a caller must hold for a planned action to do what it says. */
export type RequiredRole = {
  readonly holder: Address;
  readonly name: string;
  /**
   * Why a non-holder is refused, when the answer is not "the call reverts".
   * Set only for `dispute()`, which the contract makes permissionless: a
   * non-resolver's dispute succeeds and spends the bond, so refusing it is
   * this CLI's policy rather than the chain's. Stating the policy is the
   * point — an operator tool that silently spends collateral out of whatever
   * key happens to be configured is worse than one that declines and says
   * where to go instead.
   */
  readonly nonHolderConsequence?: string;
};

/** A planned market call: what it does, who may make it, and how to verify it. */
export type CompleteSetMarketPlan = {
  readonly call: {
    readonly args: readonly [] | readonly [number];
    readonly functionName:
      | "cancel"
      | "dispute"
      | "finalizeResolution"
      | "proposeResolution"
      | "resolve";
  };
  /** Status the market must hold once the call is mined. */
  readonly expectedStatus: number;
  readonly proposedDescription: string;
  /** Absent for `finalizeResolution`, which is deliberately permissionless. */
  readonly requiredRole?: RequiredRole;
};

/** Where an escrowed dispute bond goes when a disputed market is settled. */
export type DisputeBondSettlement =
  | { readonly amount: bigint; readonly kind: "forfeited"; readonly to: Address }
  | { readonly amount: bigint; readonly kind: "refunded"; readonly to: Address }
  | { readonly kind: "none" };

const STATUS = POSTGRAD_MARKET_STATUS;

/**
 * Determines where an escrowed dispute bond goes when the resolver settles a
 * disputed market by resolving to a side. `CompleteSetBinaryMarket.resolve`
 * refunds the disputer when the settled outcome differs from the proposal and
 * forfeits to the market owner when the proposal stands; a zero escrow (the
 * resolver's bond-free self-dispute, or a zero-bond configuration) moves
 * nothing. The proposal — not an operator argument — decides which it is.
 */
export function determineDisputeBondSettlement(input: {
  readonly bondHeld: bigint;
  readonly disputer: Address;
  readonly owner: Address;
  readonly proposedSide: MarketSide;
  readonly settledSide: MarketSide;
}): DisputeBondSettlement {
  if (input.bondHeld === 0n) {
    return { kind: "none" };
  }
  return input.settledSide === input.proposedSide
    ? { amount: input.bondHeld, kind: "forfeited", to: input.owner }
    : { amount: input.bondHeld, kind: "refunded", to: input.disputer };
}

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
  switch (request.kind) {
    case "cancelMarket":
      return planCancel(snapshot);
    case "disputeMarket":
      return planDispute(snapshot);
    case "finalizeResolution":
      return planFinalize(snapshot);
    case "proposeResolution":
      return planPropose(snapshot, request.side);
    case "resolveMarket":
      return planDirectResolve(snapshot, request.side);
    case "settleDispute":
      return planSettle(snapshot, request.side);
  }
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

function planPropose(snapshot: CompleteSetMarketSnapshot, side: MarketSide): CompleteSetMarketPlan {
  requireStatus(snapshot, STATUS.trading, "proposeResolution");
  requireSideGate(snapshot, side, "proposeResolution");
  const deadline = snapshot.timestamp + snapshot.disputeWindow;
  const window =
    snapshot.disputeWindow === 0n
      ? "the zero dispute window makes it finalizable in the same block"
      : `${formatDuration(snapshot.disputeWindow)} after the proposal block`;
  return {
    call: { args: [marketSideToContractSide(side)], functionName: "proposeResolution" },
    expectedStatus: STATUS.resolutionPending,
    proposedDescription:
      `proposeResolution(${label(side)}) -> status ResolutionPending, dispute deadline ~${deadline} ` +
      `(${window})`,
    requiredRole: resolverRole(snapshot),
  };
}

/**
 * The refusal `dispute-market` gives a non-resolver caller. `dispute()` is
 * permissionless on-chain, so this is a deliberate policy of the operator CLI,
 * not a contract rule: operator tooling performs only the resolver's bond-free
 * override, and a bonded public dispute belongs in the app's dispute panel
 * where the person posting the bond is the person who chose to.
 */
const DISPUTE_OPERATOR_ONLY_POLICY = (bond: string): string =>
  `this CLI only performs the resolver's bond-free override. dispute() is ` +
  `permissionless on-chain, so the call would not revert — it would succeed and ` +
  `spend ${bond} of collateral from the configured key. Post a bonded public ` +
  `dispute through the app's dispute panel instead`;

function planDispute(snapshot: CompleteSetMarketSnapshot): CompleteSetMarketPlan {
  requireStatus(snapshot, STATUS.resolutionPending, "dispute");
  const proposal = requireProposal(snapshot);
  if (snapshot.timestamp >= proposal.deadline) {
    throw new Error(
      `The dispute window closed at ${proposal.deadline} (block timestamp ${snapshot.timestamp}); ` +
        "dispute() would revert with DisputeWindowClosed.",
    );
  }
  const bond = formatCollateral(snapshot.disputeBond, snapshot);
  return {
    call: { args: [], functionName: "dispute" },
    expectedStatus: STATUS.disputed,
    proposedDescription:
      `dispute() -> status Disputed, freezing finalization of the ${label(proposal.side)} proposal ` +
      `until the resolver settles with resolve() or cancel(). The resolver's self-dispute is the ` +
      `bond-free operator override: it posts nothing, whereas any other caller would post the ` +
      `${bond} bond. ${formatDuration(proposal.deadline - snapshot.timestamp)} left in the window.`,
    requiredRole: {
      ...resolverRole(snapshot),
      nonHolderConsequence: DISPUTE_OPERATOR_ONLY_POLICY(bond),
    },
  };
}

function planSettle(snapshot: CompleteSetMarketSnapshot, side: MarketSide): CompleteSetMarketPlan {
  requireStatus(snapshot, STATUS.disputed, "settleDispute");
  const proposal = requireProposal(snapshot);
  const settlement = determineDisputeBondSettlement({
    bondHeld: snapshot.disputeBondHeld,
    disputer: snapshot.disputer,
    owner: snapshot.owner,
    proposedSide: proposal.side,
    settledSide: side,
  });
  return {
    call: { args: [marketSideToContractSide(side)], functionName: "resolve" },
    expectedStatus: STATUS.resolved,
    proposedDescription:
      `resolve(${label(side)}) -> status Resolved, settling the dispute over the ` +
      `${label(proposal.side)} proposal. ${describeSettlement(settlement, snapshot)}`,
    requiredRole: resolverRole(snapshot),
  };
}

function planFinalize(snapshot: CompleteSetMarketSnapshot): CompleteSetMarketPlan {
  requireStatus(snapshot, STATUS.resolutionPending, "finalizeResolution");
  const proposal = requireProposal(snapshot);
  if (snapshot.timestamp < proposal.deadline) {
    throw new Error(
      `The dispute window is open until ${proposal.deadline} — ` +
        `${formatDuration(proposal.deadline - snapshot.timestamp)} remaining at block timestamp ` +
        `${snapshot.timestamp}; finalizeResolution() would revert with DisputeWindowStillOpen.`,
    );
  }
  return {
    call: { args: [], functionName: "finalizeResolution" },
    expectedStatus: STATUS.resolved,
    proposedDescription:
      `finalizeResolution() -> status Resolved, winning side ${label(proposal.side)}. ` +
      "Permissionless: any account may finalize, so a keeper or a trader may get there first.",
  };
}

function planDirectResolve(
  snapshot: CompleteSetMarketSnapshot,
  side: MarketSide,
): CompleteSetMarketPlan {
  requireStatus(snapshot, STATUS.trading, "resolve");
  requireSideGate(snapshot, side, "resolve");
  if (snapshot.disputeWindow !== 0n) {
    throw new Error(
      `This market carries a ${describeWindow(snapshot.disputeWindow)} dispute window, so resolve() ` +
        "from Trading reverts with MarketNotDirectlyResolvable; use propose-resolution instead.",
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

function describeSettlement(
  settlement: DisputeBondSettlement,
  snapshot: CompleteSetMarketSnapshot,
): string {
  switch (settlement.kind) {
    case "forfeited":
      return (
        `The proposal stands, so the ${formatCollateral(settlement.amount, snapshot)} bond is ` +
        `FORFEITED to the market owner ${settlement.to}.`
      );
    case "none":
      return "No bond is escrowed, so no collateral moves.";
    case "refunded":
      return (
        `The settled side differs from the proposal, so the ` +
        `${formatCollateral(settlement.amount, snapshot)} bond is REFUNDED to the disputer ` +
        `${settlement.to}.`
      );
  }
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

// Both proposing and resolving carry the per-side pregrad time gate.
function requireSideGate(
  snapshot: CompleteSetMarketSnapshot,
  side: MarketSide,
  action: string,
): void {
  const notBefore = snapshot.notBefore[side];
  if (snapshot.timestamp < notBefore) {
    throw new Error(
      `The ${label(side)} resolution gate opens at ${notBefore} — ` +
        `${formatDuration(notBefore - snapshot.timestamp)} away at block timestamp ` +
        `${snapshot.timestamp}; ${action} would revert with TooEarlyToResolve.`,
    );
  }
}

// The proposal getters revert unless a proposal is active, so the snapshot
// omits them outside those statuses; every caller here has already checked.
function requireProposal(
  snapshot: CompleteSetMarketSnapshot,
): NonNullable<CompleteSetMarketSnapshot["proposal"]> {
  if (snapshot.proposal === undefined) {
    throw new Error("Expected an active resolution proposal to read; the market has none.");
  }
  return snapshot.proposal;
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
