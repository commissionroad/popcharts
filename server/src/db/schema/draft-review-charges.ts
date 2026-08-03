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
 * What a meter charge paid for: a draft submission (which bundles its first
 * five review runs, ADR 0022 §3) or a sixth-and-later review of the same
 * draft.
 */
export const DRAFT_REVIEW_CHARGE_KINDS = [
  "submission",
  "extra_review",
] as const;

/** One of {@link DRAFT_REVIEW_CHARGE_KINDS}. */
export type DraftReviewChargeKind = (typeof DRAFT_REVIEW_CHARGE_KINDS)[number];

/** Postgres enum for DraftReviewChargeKind, derived from the same const array. */
export const draftReviewChargeKind = pgEnum("draft_review_charge_kind", [
  ...DRAFT_REVIEW_CHARGE_KINDS,
]);

/**
 * The off-chain review meter (ADR 0022 §3): one row per charge against a
 * wallet's on-chain review bond. Rows are the accounting the resolver
 * settles on-chain in batches — a charge is `unsettled` until a settlement
 * transaction covering it lands, at which point `settledAt` is stamped. The
 * money paper trail is the vault's event stream (review_bond_events); these
 * rows only decide when and how much to settle, and gate new submissions on
 * the bonded balance minus the unsettled tally.
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
    /** Stamped when a settlement covering this charge lands on-chain. */
    settledAt: timestamp("settled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("draft_review_charges_address_settled_idx").on(
      table.chargedAddress,
      table.settledAt,
    ),
    index("draft_review_charges_draft_idx").on(table.draftId),
  ],
);

/** Drizzle select shape of a draft_review_charges row. */
export type DraftReviewChargeRow = typeof draftReviewCharges.$inferSelect;
