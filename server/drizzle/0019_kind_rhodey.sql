CREATE TYPE "public"."complete_set_kind" AS ENUM('minted', 'merged');--> statement-breakpoint
CREATE TABLE "complete_set_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"postgrad_market" text NOT NULL,
	"kind" "complete_set_kind" NOT NULL,
	"account" text NOT NULL,
	"recipient" text,
	"collateral_amount" numeric(78, 0) NOT NULL,
	"outcome_amount" numeric(78, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "complete_set_events" ADD CONSTRAINT "complete_set_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "complete_set_events_chain_tx_log_idx" ON "complete_set_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "complete_set_events_chain_market_idx" ON "complete_set_events" USING btree ("chain_id","market_id");