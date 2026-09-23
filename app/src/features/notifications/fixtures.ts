import type { MarketStatusNotification } from "./notification-types";

/**
 * Fixed clock for every story, so relative times ("6m ago") are stable across
 * renders and screenshots instead of drifting with the wall clock.
 */
export const NOW = new Date("2026-09-01T12:00:00.000Z");

const CHAIN_ID = 31337;

/** An ISO timestamp `minutes` before {@link NOW}. */
function ago(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function notification(
  overrides: Partial<MarketStatusNotification> &
    Pick<MarketStatusNotification, "id" | "to">
): MarketStatusNotification {
  return {
    chainId: CHAIN_ID,
    from: null,
    marketId: "7",
    marketQuestion: "Will it pop?",
    occurredAt: ago(5),
    read: false,
    relationship: "watching",
    ...overrides,
  };
}

/**
 * Resolved, with money waiting. The case the whole affordance is sized for:
 * it never auto-dismisses, it keeps its action, and it survives in the inbox
 * for the viewer who was not at the screen when it happened.
 */
export const claimablePayout = notification({
  action: { href: "/portfolio", label: "Claim $412.60" },
  detail: "YES won. 480 outcome tokens are redeemable.",
  from: "resolution_pending",
  id: "n-payout",
  marketId: "104",
  marketQuestion:
    "Will the Arc mainnet beta open to public validators before 1 Nov 2026?",
  occurredAt: ago(6),
  relationship: "holding",
  to: "resolved",
});

/** A dispute reopening an outcome you are exposed to. */
export const disputeOnHeldMarket = notification({
  detail: "A challenger staked against the proposed NO outcome.",
  from: "resolution_pending",
  id: "n-dispute",
  marketId: "88",
  marketQuestion: "Will global chip fab capacity grow more than 8% in 2026?",
  occurredAt: ago(18),
  relationship: "holding",
  to: "disputed",
});

/** Graduation on a market you hold receipts in — no action, still yours. */
export const graduatedHolding = notification({
  detail: "Your 120 YES receipts became backed outcome tokens.",
  from: "graduating",
  id: "n-graduated",
  marketId: "42",
  marketQuestion: "Will the next Fed decision be a cut of 25bp or more?",
  occurredAt: ago(2),
  relationship: "holding",
  to: "graduated",
});

/** The same shape of event on a market you only ever opened once. */
export const graduatingWatched = notification({
  from: "bootstrap",
  id: "n-graduating-watched",
  marketId: "51",
  marketQuestion: "Will a category 5 hurricane make US landfall in 2026?",
  occurredAt: ago(31),
  relationship: "watching",
  to: "graduating",
});

/** A watched market entering its dispute window. */
export const resolutionPendingWatched = notification({
  from: "graduated",
  id: "n-pending-watched",
  marketId: "63",
  marketQuestion: "Will the summer transfer record be broken before September?",
  occurredAt: ago(64),
  read: true,
  relationship: "watching",
  to: "resolution_pending",
});

/** A market that never made its target — collateral comes back. */
export const refundedHolding = notification({
  action: { href: "/portfolio", label: "Claim refund $60.00" },
  detail: "The market missed its graduation target. Your stake is returned.",
  from: "bootstrap",
  id: "n-refunded",
  marketId: "19",
  marketQuestion: "Will a new element be added to the periodic table in 2026?",
  occurredAt: ago(182),
  read: true,
  relationship: "holding",
  to: "refunded",
});

/** A postgrad draw: cancelled, with a complete-set redemption waiting. */
export const cancelledHolding = notification({
  action: { href: "/portfolio", label: "Redeem $88.00" },
  detail: "Resolved as a draw. Both sides redeem at par.",
  from: "graduated",
  id: "n-cancelled",
  marketId: "77",
  marketQuestion: "Will the two leading candidates finish within 0.5 points?",
  occurredAt: ago(1_500),
  read: true,
  relationship: "holding",
  to: "cancelled",
});

/** A watched market clearing review and opening for receipts. */
export const openedForReceiptsWatched = notification({
  from: "under_review",
  id: "n-bootstrap-watched",
  marketId: "95",
  marketQuestion: "Will annual CPI print below 2.5% in any month of 2026?",
  occurredAt: ago(300),
  read: true,
  relationship: "watching",
  to: "bootstrap",
});

/** A transition whose prior status the client never saw — one pill, not two. */
export const unknownPriorStatus = notification({
  detail: "Reconnected after being offline; the earlier status was not replayed.",
  id: "n-unknown-prior",
  marketId: "31",
  marketQuestion: "Will the launch window slip past Q4 2026?",
  occurredAt: ago(9),
  relationship: "holding",
  to: "graduated",
});

/** Newest first, the order every surface expects. */
export const inboxBacklog: MarketStatusNotification[] = [
  graduatedHolding,
  claimablePayout,
  unknownPriorStatus,
  disputeOnHeldMarket,
  graduatingWatched,
  resolutionPendingWatched,
  refundedHolding,
  openedForReceiptsWatched,
  cancelledHolding,
];

/** Four arriving in the same tick — more than the toast column will show. */
export const simultaneousArrivals: MarketStatusNotification[] = [
  graduatedHolding,
  graduatingWatched,
  unknownPriorStatus,
  claimablePayout,
  disputeOnHeldMarket,
];
