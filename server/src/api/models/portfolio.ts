import { t, type Static } from "elysia";

import {
  MarketResolutionSchema,
  MarketStatusSchema,
  VenueOrderSchema,
  VenuePoolSideSchema,
} from "src/api/models/markets";
import { POSTGRAD_REDEMPTION_KINDS } from "src/db/schema/postgrad-redemption-events";
import { literalUnion } from "src/shared/typebox-literals";

/**
 * Portfolio read models (docs/portfolio-data-design.md). All bigints are
 * strings, timestamps ISO, addresses lowercase, mirroring the market models.
 * Amount conventions: outcome-token quantities are WAD (18-decimal) strings;
 * `cost` / `retainedCost` / `refund` / `lockedCollateral` are raw collateral
 * units (6-decimal on Arc); prices and values are display-WAD (collateral per
 * outcome token, 1e18-scaled) so clients never re-derive decimal scaling.
 */

/**
 * Lifecycle state of one receipt: `awaiting_graduation` while the market is
 * pre-graduation, `claimable` when the market graduated but this receipt has
 * no claim yet, `refund_claimable` when the market refunded/cancelled without
 * a claim yet, and `settled` / `refunded` once the claim row exists.
 */
export const PortfolioReceiptStatusSchema = t.Union(
  [
    t.Literal("awaiting_graduation"),
    t.Literal("claimable"),
    t.Literal("refund_claimable"),
    t.Literal("settled"),
    t.Literal("refunded"),
  ],
  { $id: "PortfolioReceiptStatus" },
);

/**
 * Settlement result of a claimed receipt. For graduated claims
 * `retainedShares` is the outcome tokens minted and `retainedCost` the
 * collateral converted (implied avg fill = retainedCost / retainedShares);
 * refund-only claims carry just the refund.
 */
export const PortfolioReceiptSettlementSchema = t.Object(
  {
    claimedAt: t.String(),
    refund: t.String(),
    retainedCost: t.Optional(t.String()),
    retainedShares: t.Optional(t.String()),
  },
  { $id: "PortfolioReceiptSettlement" },
);

/**
 * One pre-graduation receipt and, once claimed, its settlement result —
 * joined from receipt_placed_events and the claim-event tables on
 * (chainId, receiptId). `priceBandLow`/`priceBandHigh` are the LMSR
 * probability interval (WAD) the buy swept.
 */
export const PortfolioReceiptSchema = t.Object(
  {
    cost: t.String(),
    marketId: t.String(),
    marketQuestion: t.Optional(t.String()),
    marketStatus: t.Ref(MarketStatusSchema),
    placedAt: t.String(),
    priceBandHigh: t.String(),
    priceBandLow: t.String(),
    receiptId: t.String(),
    settlement: t.Optional(t.Ref(PortfolioReceiptSettlementSchema)),
    shares: t.String(),
    side: t.Ref(VenuePoolSideSchema),
    status: t.Ref(PortfolioReceiptStatusSchema),
  },
  { $id: "PortfolioReceipt" },
);

/**
 * A wallet's stake in one graduated market outcome. `heldBalance` is the
 * indexed wallet balance; `committedInOrders` is outcome tokens locked in the
 * wallet's own open ask orders (pulled into the pool manager while resting);
 * `ownedTotal` is their sum. `poolPriceWad` / `currentValueWad` (display-WAD)
 * are omitted while the pool is uninitialized or the venue read fails.
 * `graduationShares` / `avgCostWad` are provenance from settled receipts and
 * cover only graduation-derived tokens, not later venue trades.
 * `marketStatus` is present whenever the market row is known; `resolution`
 * accompanies a resolved/cancelled market so clients can offer the redeem
 * write (on `resolution.postgradMarket`) without a second market read.
 */
export const PortfolioPositionSchema = t.Object(
  {
    avgCostWad: t.Optional(t.String()),
    committedInOrders: t.String(),
    currentValueWad: t.Optional(t.String()),
    graduationShares: t.Optional(t.String()),
    heldBalance: t.String(),
    marketId: t.String(),
    marketQuestion: t.Optional(t.String()),
    marketStatus: t.Optional(t.Ref(MarketStatusSchema)),
    outcomeToken: t.String(),
    ownedTotal: t.String(),
    poolId: t.Optional(t.String()),
    poolPriceWad: t.Optional(t.String()),
    resolution: t.Optional(t.Ref(MarketResolutionSchema)),
    side: t.Ref(VenuePoolSideSchema),
  },
  { $id: "PortfolioPosition" },
);

/**
 * One resolution-redemption payout, read straight from the indexed
 * Redeemed/CancelledRedeemed money paper trail. A `redeemed` row burned
 * `outcomeAmount` tokens of `side`; a `cancelled_redeemed` (draw) row burned
 * `yesAmount` + `noAmount` at half value each. `collateralAmount` is the raw
 * collateral paid out (chain-specific precision); `valueWad` is the same
 * payout as a display-WAD value, omitted only when the collateral's decimals
 * are unavailable (unknown market or failed chain read).
 */
export const PortfolioRedemptionSchema = t.Object(
  {
    collateralAmount: t.String(),
    kind: literalUnion(POSTGRAD_REDEMPTION_KINDS),
    logIndex: t.Number(),
    marketId: t.String(),
    marketQuestion: t.Optional(t.String()),
    noAmount: t.Optional(t.String()),
    outcomeAmount: t.Optional(t.String()),
    redeemedAt: t.String(),
    side: t.Optional(t.Ref(VenuePoolSideSchema)),
    transactionHash: t.String(),
    valueWad: t.Optional(t.String()),
    yesAmount: t.Optional(t.String()),
  },
  { $id: "PortfolioRedemption" },
);

/** One resting venue maker order, annotated with its market for display. */
export const PortfolioOpenOrderSchema = t.Object(
  {
    marketId: t.String(),
    marketQuestion: t.Optional(t.String()),
    order: t.Ref(VenueOrderSchema),
  },
  { $id: "PortfolioOpenOrder" },
);

/**
 * Headline numbers. `lockedCollateral` sums the cost of receipts still
 * awaiting graduation; `totalPositionValueWad` sums the priced positions'
 * currentValueWad (positions without a pool price contribute nothing).
 */
export const PortfolioSummarySchema = t.Object(
  {
    claimableReceiptCount: t.Number(),
    lockedCollateral: t.String(),
    openOrderCount: t.Number(),
    openReceiptCount: t.Number(),
    positionCount: t.Number(),
    totalPositionValueWad: t.String(),
  },
  { $id: "PortfolioSummary" },
);

/**
 * A wallet's full lifecycle view: receipts, positions, open orders, and past
 * resolution redemptions (newest first).
 */
export const PortfolioSchema = t.Object(
  {
    chainId: t.Number(),
    openOrders: t.Array(t.Ref(PortfolioOpenOrderSchema)),
    owner: t.String(),
    positions: t.Array(t.Ref(PortfolioPositionSchema)),
    receipts: t.Array(t.Ref(PortfolioReceiptSchema)),
    redemptions: t.Array(t.Ref(PortfolioRedemptionSchema)),
    summary: t.Ref(PortfolioSummarySchema),
  },
  { $id: "Portfolio" },
);

export type PortfolioReceiptStatusResponse = Static<
  typeof PortfolioReceiptStatusSchema
>;
export type PortfolioReceiptSettlementResponse = Static<
  typeof PortfolioReceiptSettlementSchema
>;
export type PortfolioReceiptResponse = Static<typeof PortfolioReceiptSchema>;
export type PortfolioPositionResponse = Static<typeof PortfolioPositionSchema>;
export type PortfolioRedemptionResponse = Static<
  typeof PortfolioRedemptionSchema
>;
export type PortfolioOpenOrderResponse = Static<
  typeof PortfolioOpenOrderSchema
>;
export type PortfolioSummaryResponse = Static<typeof PortfolioSummarySchema>;
export type PortfolioResponse = Static<typeof PortfolioSchema>;
