ALTER TYPE "public"."draft_review_charge_kind" ADD VALUE 'review_run';--> statement-breakpoint
ALTER TABLE "draft_review_charges" ADD COLUMN "rate" numeric(78, 0) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "review_bond_events" ADD COLUMN "payer" text;