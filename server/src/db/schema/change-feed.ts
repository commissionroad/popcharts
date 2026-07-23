import {
  bigint,
  bigserial,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * The live-updates outbox (repo ADR 0021). One append-only row per committed
 * viewer-facing change, written by an explicit `recordLiveChange(tx, …)` call in
 * the SAME transaction as the change (src/change-feed/writer.ts) — so a row
 * exists if and only if the change committed (a rolled-back indexer event, e.g.
 * the MarketNotIndexedError retry path, leaves no signal). The API relay tails
 * this table and fans the rows out to SSE clients; nothing here is authoritative
 * data, only a "re-read entity X" signal, so the columns are the minimum needed
 * to route (`market_id` / `owner`), order/dedupe (`id`, `block_number` +
 * `log_index`), and prune (`created_at`).
 *
 * Every column except `id`, `created_at`, `source_table`, and `op` is nullable:
 * a source that has no holder simply records NULL `owner`. The seam records the
 * live change last in its transaction so no later statement can fail after the
 * signal is written; the insert is still atomic with — and rolls back alongside
 * — the underlying write. See src/change-feed/sources.ts for the
 * source→channel routing set.
 */
export const changeFeed = pgTable(
  "change_feed",
  {
    // bigserial: the monotonic cursor the relay tails and the value echoed back
    // as the SSE Last-Event-ID for gap-free resume. Never reused, never reset.
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    // The table whose row changed, as the seam recorded it; the relay maps this
    // to a channel in TypeScript via CHANGE_FEED_SOURCES. There is no
    // client-side query-key map — the browser hook hands each signal to a
    // caller-supplied callback and the surface re-reads itself (repo ADR 0021).
    sourceTable: text("source_table").notNull(),
    // "insert" or "update"; most sources are insert-only, the review/resolution
    // job queues are the update case (deferred to a later slice).
    op: text("op").notNull(),
    // Primary key of the changed row, kept as text so one column serves both
    // int4 and int8 source keys. Routing/dedup use market_id/owner + id, not
    // this, so it is diagnostic rather than load-bearing.
    rowId: text("row_id"),
    chainId: integer("chain_id"),
    // Routing keys, kept as text: market_id spans bigint and numeric(78,0)
    // sources, and we only ever compare or concatenate it into a channel name.
    marketId: text("market_id"),
    owner: text("owner"),
    // On-chain version for client-side ordering/dedup; absent on the off-chain
    // review/resolution sources, which order by id instead.
    blockNumber: bigint("block_number", { mode: "bigint" }),
    logIndex: integer("log_index"),
  },
  (table) => [
    // Retention prune deletes by age; the PK index already serves the
    // relay's `WHERE id > cursor ORDER BY id` tail.
    index("change_feed_created_at_idx").on(table.createdAt),
  ],
);
