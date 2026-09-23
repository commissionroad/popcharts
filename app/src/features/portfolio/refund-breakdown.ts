import type { PortfolioReceipt } from "@popcharts/api-client/models";

import type { Market, MarketSide } from "@/domain/markets/types";
import { wadToNumber } from "@/domain/tokens/wad";
import { apiMarketAppId } from "@/lib/app-id";
import { formatDateTime, formatUsd, formatUsdWhole } from "@/lib/format";

/**
 * Why a market ended without graduating, and what that means for the money.
 * Kept as a pure derivation beside {@link refundBreakdown} so the market-detail
 * banner, the market-detail refund panel and the portfolio refund card all say
 * the same thing word for word — the same reason `receiptSettlementResult`
 * lives here rather than in either surface.
 */
export type ReceiptClosure = {
  /** Short headline for the closed state. */
  headline: string;
  /** Which non-graduation path the market took. */
  kind: "cancelled" | "not_graduated";
  /**
   * The reason in one clause, for the narrow surfaces — the aside refund panel
   * and the portfolio card — which sit next to the amounts and would only
   * repeat {@link MarketClosure.detail} at the reader.
   */
  summary: string;
};

export type MarketClosure = ReceiptClosure & {
  /**
   * The full explanation, for the market-detail banner: why the market ended,
   * how far it got, and what happens to the money.
   */
  detail: string;
};

/** Which non-graduation path a market took. */
export type MarketClosureKind = MarketClosure["kind"];

/**
 * The headline and one-clause reason for each closure, held in one table so the
 * market-detail surfaces (which know the whole market) and the portfolio card
 * (which knows only a receipt's market status) cannot drift into two vocabularies
 * for the same ending.
 */
const CLOSURE_COPY = {
  cancelled: {
    headline: "Cancelled before graduation",
    summary:
      "The owner cancelled this market before it graduated, so every receipt refunds in full.",
  },
  not_graduated: {
    headline: "Closed without graduating",
    summary:
      "This market closed without reaching graduation, so every receipt refunds in full.",
  },
} as const satisfies Record<MarketClosureKind, { headline: string; summary: string }>;

/**
 * Which non-graduation path a market took, or null when it took none.
 *
 * Two statuses reach here and only two. `refunded` is terminal and always
 * pre-graduation: the receipt book never cleared, so every receipt refunds.
 * `cancelled` is ambiguous by status alone — a post-graduation draw carries a
 * terminal `resolution` event and redeems outcome tokens at half value through
 * the claim panel, while a pre-graduation owner cancel has no resolution and
 * refunds receipts. Only the second is a refund path, which is why `resolution`
 * is part of the question and not an afterthought.
 */
export function marketClosureKind(
  market: Pick<Market, "resolution" | "status">
): MarketClosureKind | null {
  if (market.status === "cancelled") {
    return market.resolution ? null : "cancelled";
  }

  return market.status === "refunded" ? "not_graduated" : null;
}

/**
 * The non-graduation closure of a market, or null when the market did not take
 * one of those paths. The full {@link MarketClosure.detail} needs the market
 * itself; surfaces holding only a receipt use {@link receiptClosure}.
 */
export function marketClosure(
  market: Pick<
    Market,
    "closesAt" | "graduationTargetUsd" | "matchedUsd" | "resolution" | "status"
  >
): MarketClosure | null {
  const kind = marketClosureKind(market);

  if (!kind) {
    return null;
  }

  if (kind === "cancelled") {
    return {
      ...CLOSURE_COPY.cancelled,
      detail:
        "The market owner cancelled this market before it graduated, so no outcome tokens were ever created. Every receipt refunds in full — escrowed cost and the entry fee paid on it.",
      kind,
    };
  }

  // The graduation target is what the market failed to reach, so naming both
  // sides of that comparison is the whole explanation. A market with no
  // recorded target (fixture-backed, or created before targets were stored)
  // degrades to the closing date rather than printing "$0 of $0".
  const shortfall =
    market.graduationTargetUsd > 0
      ? ` It matched ${formatUsdWhole(market.matchedUsd)} of its ${formatUsdWhole(
          market.graduationTargetUsd
        )} graduation target.`
      : "";

  return {
    ...CLOSURE_COPY.not_graduated,
    detail: `This market closed ${formatDateTime(
      market.closesAt
    )} without reaching graduation, so no outcome tokens were ever created.${shortfall} Every receipt refunds in full — escrowed cost and the entry fee paid on it.`,
    kind,
  };
}

/**
 * The closure behind a refund-state receipt, from the market status the receipt
 * carries.
 *
 * A receipt is the only handle the portfolio has on its market, and it carries
 * no `resolution` — but it does not need one. A post-graduation draw cleared
 * its receipt book at graduation, so its receipts are `settled`, never
 * `refund_claimable` or `refunded`. A receipt in a refund state on a
 * `cancelled` market therefore belongs to a pre-graduation owner cancel, and
 * the ambiguity {@link marketClosureKind} guards against cannot arise. Returns
 * null for a receipt whose market is on any other path, so callers filter
 * rather than assume.
 */
export function receiptClosure(
  receipt: Pick<PortfolioReceipt, "marketStatus">
): ReceiptClosure | null {
  if (receipt.marketStatus === "cancelled") {
    return { ...CLOSURE_COPY.cancelled, kind: "cancelled" };
  }

  return receipt.marketStatus === "refunded"
    ? { ...CLOSURE_COPY.not_graduated, kind: "not_graduated" }
    : null;
}

/** One receipt's share of a market's refund. */
export type RefundLine = {
  /**
   * The entry fee refunded alongside escrow, or null when the paid fee is not
   * known to this surface.
   *
   * The entry fee is a success fee: the protocol earns it only on the part of
   * a receipt that matches, so on every non-graduation path it returns in full
   * with the escrow (protocol ADR 0014 §3). That ADR also requires the fee to
   * be read from the amount *stored on the receipt* rather than re-derived
   * from the current rate, which would pay today's rate on an old receipt —
   * so this is an input, never a calculation. `PortfolioReceipt` does not
   * carry the paid fee yet; until it does, callers pass what they know and
   * surfaces render the split only when it is known.
   */
  entryFeeWad: bigint | null;
  /** The receipt's escrowed cost, returned in full. */
  escrowWad: bigint;
  receiptId: string;
  side: MarketSide;
  /** What actually lands in the wallet: escrow plus any known entry fee. */
  totalWad: bigint;
};

/** A market's refund, split into what is still claimable and what was claimed. */
export type RefundBreakdown = {
  claimable: RefundLine[];
  claimableTotalWad: bigint;
  claimed: RefundLine[];
  claimedTotalWad: bigint;
  /**
   * Entry fee across the claimable lines, or null when any line's fee is
   * unknown — a partial total would read as the whole fee and understate the
   * refund.
   */
  entryFeeTotalWad: bigint | null;
};

/**
 * Splits a market's receipts into the refund still owed and the refund already
 * taken. `entryFees` maps receipt id to the WAD-scaled fee paid on that
 * receipt; omit it (or omit an id) where the paid fee is not known, and the
 * line reports escrow alone rather than guessing.
 *
 * Only the two refund states participate: `refund_claimable` is a refund the
 * holder has not pulled yet, and `refunded` is one they have. Receipts in any
 * other state belong to a market that is still running or that graduated, and
 * are none of this surface's business.
 */
export function refundBreakdown(
  receipts: PortfolioReceipt[],
  entryFees: Record<string, string> = {}
): RefundBreakdown {
  const line = (receipt: PortfolioReceipt, escrowWad: bigint): RefundLine => {
    const fee = entryFees[receipt.receiptId];
    const entryFeeWad = fee === undefined ? null : BigInt(fee);

    return {
      entryFeeWad,
      escrowWad,
      receiptId: receipt.receiptId,
      side: receipt.side,
      totalWad: escrowWad + (entryFeeWad ?? 0n),
    };
  };

  const claimable = receipts
    .filter((receipt) => receipt.status === "refund_claimable")
    // A full refund returns the receipt's entire escrowed cost, so the amount
    // is known before the claim — no settlement row needed.
    .map((receipt) => line(receipt, BigInt(receipt.cost)));

  const claimed = receipts
    .filter((receipt) => receipt.status === "refunded")
    // A claimed refund reports what was actually returned, which the indexer
    // records on the settlement; a receipt still missing that row falls back to
    // its escrowed cost, the amount the refund pays by definition.
    .map((receipt) =>
      line(receipt, BigInt(receipt.settlement?.refund ?? receipt.cost))
    );

  const total = (lines: RefundLine[]) =>
    lines.reduce((sum, entry) => sum + entry.totalWad, 0n);

  return {
    claimable,
    claimableTotalWad: total(claimable),
    claimed,
    claimedTotalWad: total(claimed),
    entryFeeTotalWad: claimable.every((entry) => entry.entryFeeWad !== null)
      ? claimable.reduce((sum, entry) => sum + (entry.entryFeeWad ?? 0n), 0n)
      : null,
  };
}

/**
 * The escrow/fee/total split as display strings, in the order a refund reads:
 * what was escrowed, what the entry fee adds back, and what lands in the
 * wallet. Returns the total alone when the fee is unknown, because a two-row
 * split with a missing row invites the reader to infer a zero fee.
 */
export function refundSplitRows(breakdown: RefundBreakdown): {
  label: string;
  value: string;
}[] {
  const fee = breakdown.entryFeeTotalWad;

  if (fee === null) {
    return [
      { label: "Refund", value: formatUsd(wadToNumber(breakdown.claimableTotalWad)) },
    ];
  }

  return [
    {
      label: "Escrowed cost",
      value: formatUsd(wadToNumber(breakdown.claimableTotalWad - fee)),
    },
    { label: "Entry fee returned", value: formatUsd(wadToNumber(fee)) },
    {
      label: "Total refund",
      value: formatUsd(wadToNumber(breakdown.claimableTotalWad)),
    },
  ];
}

/** The two receipt states a refund passes through: owed, and then taken. */
function isRefundState(status: PortfolioReceipt["status"]): boolean {
  return status === "refund_claimable" || status === "refunded";
}

/** One closed market's refund, as the portfolio lists it. */
export type ClosedMarketRefund = {
  breakdown: RefundBreakdown;
  closure: ReceiptClosure;
  /** App-facing id ("chainId:marketId") for the link to the market's claim. */
  marketAppId: string;
  question: string;
};

/**
 * Groups a portfolio's refund-state receipts into one row per closed market —
 * the portfolio-side view of the same endings the market page explains one at a
 * time.
 *
 * Grouping is the point: the receipts table already lists these receipts row by
 * row, where a holder with four receipts on one dead market sees four
 * unrelated-looking refunds and no statement of what happened. A market is the
 * unit the ending belongs to, so it is the unit the refund is totalled on.
 *
 * Market order follows first appearance in `receipts`, so the card's order
 * tracks whatever ordering the portfolio read already applied instead of
 * imposing a second one.
 */
export function closedMarketRefunds(
  receipts: PortfolioReceipt[],
  chainId: number,
  entryFees: Record<string, string> = {}
): ClosedMarketRefund[] {
  // The closure and the question are captured when a market first appears, so
  // the grouped value already carries everything a row needs. Grouping bare
  // receipts instead would leave the row rebuilding a closure it has no
  // guarantee exists, which is a defensive branch nothing can reach.
  const byMarket = new Map<
    string,
    { closure: ReceiptClosure; question: string; receipts: PortfolioReceipt[] }
  >();

  for (const receipt of receipts) {
    const closure = receiptClosure(receipt);

    // Both gates matter. The closure gate drops markets on any other path; the
    // status gate drops a closed market's non-refund receipts, which would
    // otherwise seed a market row whose breakdown totals nothing.
    if (!closure || !isRefundState(receipt.status)) {
      continue;
    }

    const group = byMarket.get(receipt.marketId);

    if (group) {
      group.receipts.push(receipt);
    } else {
      byMarket.set(receipt.marketId, {
        closure,
        // The question is optional on the wire; the market id is the only other
        // handle a reader has on which market a row is about.
        question: receipt.marketQuestion ?? `Market #${receipt.marketId}`,
        receipts: [receipt],
      });
    }
  }

  return [...byMarket.entries()].map(([marketId, group]) => ({
    breakdown: refundBreakdown(group.receipts, entryFees),
    closure: group.closure,
    marketAppId: apiMarketAppId({ chainId, marketId }),
    question: group.question,
  }));
}
