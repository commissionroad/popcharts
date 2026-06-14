CREATE TYPE "public"."market_status" AS ENUM('bootstrap', 'graduating', 'graduated', 'resolved', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" serial PRIMARY KEY NOT NULL,
	"address" varchar(42) NOT NULL,
	"name" varchar(100) NOT NULL,
	"chain_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "indexer_cursors" (
	"id" serial PRIMARY KEY NOT NULL,
	"contract_address" text NOT NULL,
	"chain_id" integer NOT NULL,
	"cursor_name" text NOT NULL,
	"last_processed_block" bigint NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_created_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"creator" text NOT NULL,
	"metadata_hash" varchar(66) NOT NULL,
	"collateral" text NOT NULL,
	"opening_probability_wad" bigint NOT NULL,
	"liquidity_parameter" bigint NOT NULL,
	"graduation_threshold" bigint NOT NULL,
	"graduation_time_unix" bigint NOT NULL,
	"resolution_time_unix" bigint NOT NULL,
	"graduation_time" timestamp NOT NULL,
	"resolution_time" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"status" "market_status" DEFAULT 'bootstrap' NOT NULL,
	"creator" text NOT NULL,
	"metadata_hash" varchar(66) NOT NULL,
	"collateral" text NOT NULL,
	"opening_probability_wad" bigint NOT NULL,
	"liquidity_parameter" bigint NOT NULL,
	"graduation_threshold" bigint NOT NULL,
	"graduation_time" timestamp NOT NULL,
	"resolution_time" timestamp NOT NULL,
	"receipt_count" bigint DEFAULT 0 NOT NULL,
	"total_escrowed" bigint DEFAULT 0 NOT NULL,
	"yes_shares" bigint DEFAULT 0 NOT NULL,
	"no_shares" bigint DEFAULT 0 NOT NULL,
	"created_block_number" bigint NOT NULL,
	"created_block_timestamp" timestamp NOT NULL,
	"created_transaction_hash" text NOT NULL,
	"created_log_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_created_events" ADD CONSTRAINT "market_created_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_address_chain_idx" ON "contracts" USING btree ("address","chain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "indexer_cursors_identity_idx" ON "indexer_cursors" USING btree ("contract_address","chain_id","cursor_name");--> statement-breakpoint
CREATE UNIQUE INDEX "market_created_events_chain_tx_log_idx" ON "market_created_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_chain_market_idx" ON "markets" USING btree ("chain_id","market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_created_tx_log_idx" ON "markets" USING btree ("created_transaction_hash","created_log_index");