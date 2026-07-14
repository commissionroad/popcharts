CREATE TYPE "public"."postgrad_resolution_kind" AS ENUM('resolved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."postgrad_winning_side" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TABLE "postgrad_resolution_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"postgrad_market" text NOT NULL,
	"kind" "postgrad_resolution_kind" NOT NULL,
	"winning_side" "postgrad_winning_side",
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "postgrad_resolution_events" ADD CONSTRAINT "postgrad_resolution_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "postgrad_resolution_events_chain_tx_log_idx" ON "postgrad_resolution_events" USING btree ("chain_id","transaction_hash","log_index");