CREATE TYPE "public"."draft_review_charge_kind" AS ENUM('submission', 'extra_review');--> statement-breakpoint
CREATE TYPE "public"."review_bond_event_kind" AS ENUM('deposited', 'settled', 'bond_withdrawn', 'fees_withdrawn');--> statement-breakpoint
CREATE TABLE "draft_review_charges" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer NOT NULL,
	"charged_address" text NOT NULL,
	"kind" "draft_review_charge_kind" NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"settled_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_bond_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"kind" "review_bond_event_kind" NOT NULL,
	"account" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"running_total" numeric(78, 0),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "draft_review_charges" ADD CONSTRAINT "draft_review_charges_draft_id_market_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."market_drafts"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_bond_events" ADD CONSTRAINT "review_bond_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "draft_review_charges_address_settled_idx" ON "draft_review_charges" USING btree ("charged_address","settled_at");--> statement-breakpoint
CREATE INDEX "draft_review_charges_draft_idx" ON "draft_review_charges" USING btree ("draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_bond_events_chain_tx_log_idx" ON "review_bond_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "review_bond_events_chain_account_idx" ON "review_bond_events" USING btree ("chain_id","account");