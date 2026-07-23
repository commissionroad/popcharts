import {
  MARKET_LIST_CHANNEL,
  marketChannel,
  portfolioChannel,
  type ChangeSignalSource,
} from "@popcharts/live-channels";

import type { schema } from "src/db/client";

/**
 * The single source of truth for the live-updates change feed (repo ADR 0021):
 * which tables emit `change_feed` rows and, for each, which SSE channels a row
 * routes to. The write seams that call `recordLiveChange` name a `sourceTable`
 * from this map, and the relay's routing (src/change-feed/relay.ts) reads
 * routes back out of it, so a table can never be signalled-but-unrouted — the
 * `sourceTable` argument is typed as {@link ChangeFeedSourceTable}, and the
 * coverage test asserts every entry is reached by a real seam.
 *
 * Slice 1 (the server spine) covers the market-keyed, append-only tables, whose
 * rows carry `chain_id` + `market_id` (and `owner`/`account` for the holder),
 * so a seam routes them with no join. Deliberately DEFERRED to later slices,
 * because they need join-based or dual-party routing the seam would have to do
 * itself:
 *   - pool/token-keyed price + trading tables (`pool_price_ticks`,
 *     `venue_order_events`, `venue_orders`) → pool→market via `venue_pools`
 *     (price/chart + order-book slices);
 *   - `outcome_token_transfer_events` → both the `from` and `to` holders
 *     (portfolio slice);
 *   - `market_ai_review_jobs` / `market_resolution_jobs` UPDATE progress
 *     (AI-review / resolution slices).
 */

/** The exact drizzle row shape the relay reads from the change_feed outbox
 * table — the raw signal a captured row produced. */
export type ChangeFeedRow = typeof schema.changeFeed.$inferSelect;

/** The capture ops a source may declare. These literals are exactly what a seam
 * records into `change_feed.op`, so the DB rows and this union must stay in
 * step. */
export type ChangeFeedOp = "insert" | "update";

/**
 * A routing target keyed off the columns a seam records on the change_feed row:
 *  - `market`      → the one market this row belongs to (`market:{chainId}:{marketId}`)
 *  - `market-list` → the global discovery list (a lifecycle transition worth
 *                    reflecting on the board)
 *  - `owner`       → the holder's portfolio (`portfolio:{owner}`)
 */
export type ChangeFeedRoute = "market" | "market-list" | "owner";

/** A registered source's capture contract: which op it records and the routes a
 * recorded row fans out to. */
export interface ChangeFeedSource {
  op: ChangeFeedOp;
  routes: ChangeFeedRoute[];
}

/**
 * Resolves the concrete SSE channels a change_feed row belongs to, given its
 * source's declared routes. A route whose keying columns are absent on the row
 * contributes nothing rather than a malformed channel, so a partial row never
 * produces a bogus subscription target.
 */
export function channelsForRow(
  row: Pick<ChangeFeedRow, "chainId" | "marketId" | "owner">,
  routes: ChangeFeedRoute[],
): string[] {
  const channels = new Set<string>();

  for (const route of routes) {
    if (route === "market" && row.chainId !== null && row.marketId !== null) {
      channels.add(marketChannel(row.chainId, row.marketId));
    } else if (route === "market-list") {
      channels.add(MARKET_LIST_CHANNEL);
    } else if (route === "owner" && row.owner !== null && row.owner !== "") {
      channels.add(portfolioChannel(row.owner));
    }
  }

  return [...channels];
}

/**
 * Table name → capture op + routes. Keys are raw Postgres table names, matching
 * the `source_table` each write seam's `recordLiveChange` records. Declared with
 * `satisfies` so the keys stay a literal union ({@link ChangeFeedSourceTable}),
 * which lets `recordLiveChange` reject an unregistered table at compile time.
 */
export const CHANGE_FEED_SOURCES = {
  // Market creation shows up on the board and opens its own page.
  market_created_events: { op: "insert", routes: ["market", "market-list"] },
  // A bet moves this market's price/chart/graduation bar and the bettor's book.
  receipt_placed_events: { op: "insert", routes: ["market", "owner"] },
  // Graduation lifecycle: the market's page and the board's status/filters.
  graduation_started_events: {
    op: "insert",
    routes: ["market", "market-list"],
  },
  clearing_root_submitted_events: { op: "insert", routes: ["market"] },
  graduation_finalized_events: {
    op: "insert",
    routes: ["market", "market-list"],
  },
  market_refunds_available_events: {
    op: "insert",
    routes: ["market", "market-list"],
  },
  market_cancelled_events: { op: "insert", routes: ["market", "market-list"] },
  // Per-receipt settlement claims: the market and the claimant's portfolio.
  graduated_receipt_claimed_events: {
    op: "insert",
    routes: ["market", "owner"],
  },
  refunded_receipt_claimed_events: {
    op: "insert",
    routes: ["market", "owner"],
  },
  // Terminal resolution + redemption (redemption keys the holder as `account`,
  // which its seam records into the change_feed `owner` column).
  postgrad_resolution_events: {
    op: "insert",
    routes: ["market", "market-list"],
  },
  postgrad_redemption_events: { op: "insert", routes: ["market", "owner"] },
  // Off-chain review verdict / resolution decision: the market and its board badge.
  market_ai_reviews: { op: "insert", routes: ["market", "market-list"] },
  market_resolutions: { op: "insert", routes: ["market", "market-list"] },
} satisfies Record<string, ChangeFeedSource>;

/** The registered source table names — the literal union a `recordLiveChange`
 * caller must name, so an unrouted table cannot be signalled. */
export type ChangeFeedSourceTable = keyof typeof CHANGE_FEED_SOURCES;

/** The tables a write seam records live changes for — the registry keys. */
export const CHANGE_FEED_SOURCE_TABLES = Object.keys(
  CHANGE_FEED_SOURCES,
) as ChangeFeedSourceTable[];

/**
 * True when a subscription's channel set overlaps an event's channels — the
 * one predicate both the hub (delivery filter) and the stream (replay filter)
 * route through, so channel-matching semantics live in exactly one place.
 */
export function channelsIntersect(
  subscribed: ReadonlySet<string>,
  eventChannels: readonly string[],
): boolean {
  for (const channel of eventChannels) {
    if (subscribed.has(channel)) {
      return true;
    }
  }
  return false;
}

/**
 * The routed shape the relay fans out to SSE clients: the cursor `id` (echoed
 * as Last-Event-ID), the channels it belongs to, and the on-chain coordinates a
 * client uses to decide which query to refetch. It carries no domain data — it
 * is a "re-read entity X" signal, per ADR 0021.
 *
 * An alias, not a second declaration: this is exactly what
 * `serializeChangeSignal` consumes, so the fields are declared once in
 * @popcharts/live-channels and named locally here. Adding a field to the wire
 * contract adds it here, with no chance of the two drifting.
 */
export type ChangeFeedEvent = ChangeSignalSource;

/**
 * Maps a raw change_feed row to its routed event, or null when the row's table
 * is not a registered source or its routing columns yield no channel (so an
 * unrouted row is dropped, never delivered to everyone).
 */
export function changeFeedRowToEvent(
  row: ChangeFeedRow,
): ChangeFeedEvent | null {
  // row.sourceTable is a free string from the DB, so widen the literal-keyed
  // registry to look it up; an unregistered table yields undefined → dropped.
  const source = (CHANGE_FEED_SOURCES as Record<string, ChangeFeedSource>)[
    row.sourceTable
  ];
  if (!source) {
    return null;
  }

  const channels = channelsForRow(row, source.routes);
  if (channels.length === 0) {
    return null;
  }

  return {
    id: row.id,
    channels,
    sourceTable: row.sourceTable,
    op: row.op,
    chainId: row.chainId,
    marketId: row.marketId,
    owner: row.owner,
    blockNumber: row.blockNumber,
    logIndex: row.logIndex,
  };
}
