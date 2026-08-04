import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { marketDrafts } from "./market-drafts";
import { uint256 } from "./uint256";

/**
 * What a meter charge paid for. Every charge is now a single `review_run` at
 * one rate — ADR 0022's prepaid-credit amendment retired the bundled
 * `submission` / `extra_review` schedule. The legacy values stay in the enum
 * because a Postgres enum cannot drop a value in place and historic rows still
 * carry them; nothing writes them any more.
 */
export const DRAFT_REVIEW_CHARGE_KINDS = [
  "submission",
  "extra_review",
  "review_run",
] as const;

/** One of {@link DRAFT_REVIEW_CHARGE_KINDS}. */
export type DraftReviewChargeKind = (typeof DRAFT_REVIEW_CHARGE_KINDS)[number];

/** Postgres enum for DraftReviewChargeKind, derived from the same const array. */
export const draftReviewChargeKind = pgEnum("draft_review_charge_kind", [
  ...DRAFT_REVIEW_CHARGE_KINDS,
]);

/**
 * The off-chain review meter (ADR 0022, prepaid-credit amendment): one row per
 * review run charged to a wallet. This is a one-way ledger — credit is
 * non-refundable, so charges are never settled back to the chain and never
 * reversed. A wallet's remaining credit is its indexed lifetime deposits
 * (`review_bond_events`) minus the sum of these rows.
 *
 * `rate` records the per-run price in force when the row was written, so the
 * ledger stays auditable across rate changes; `amount` is what was actually
 * charged. They are equal today and stay separate columns because a future
 * multi-run charge would divide them.
 */
export const draftReviewCharges = pgTable(
  "draft_review_charges",
  {
    id: serial("id").primaryKey(),
    draftId: integer("draft_id")
      .references(() => marketDrafts.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      })
      .notNull(),
    /** Wallet the charge is metered against, lowercased. */
    chargedAddress: text("charged_address").notNull(),
    kind: draftReviewChargeKind("kind").notNull(),
    /** Charge amount in the vault's native units ($1 = 1e18, ADR 0009 Q1). */
    amount: uint256("amount").notNull(),
    /** Per-review-run rate in force when this row was written, same units.
     * Defaults to 0 only so the column could land on pre-amendment rows, which
     * predate the rate concept; every live insert sets it explicitly. */
    rate: uint256("rate").notNull().default(sql`0`),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("draft_review_charges_address_idx").on(table.chargedAddress),
    index("draft_review_charges_draft_idx").on(table.draftId),
  ],
);

/** Drizzle select shape of a draft_review_charges row. */
export type DraftReviewChargeRow = typeof draftReviewCharges.$inferSelect;
