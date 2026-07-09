CREATE TYPE "public"."venue_order_event_type" AS ENUM('created', 'cancelled', 'filled', 'partially_filled', 'requeued');--> statement-breakpoint
CREATE TYPE "public"."venue_order_status" AS ENUM('open', 'filled', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."venue_pool_side" AS ENUM('yes', 'no');--> statement-breakpoint
CREATE TABLE "outcome_token_balances" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"outcome_token" text NOT NULL,
	"owner" text NOT NULL,
	"market_id" bigint NOT NULL,
	"side" "venue_pool_side" NOT NULL,
	"balance" numeric(78, 0) NOT NULL,
	"updated_block_number" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcome_token_transfer_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"outcome_token" text NOT NULL,
	"from_address" text NOT NULL,
	"to_address" text NOT NULL,
	"value" numeric(78, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_order_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"pool_id" varchar(66) NOT NULL,
	"order_id" bigint NOT NULL,
	"event_type" "venue_order_event_type" NOT NULL,
	"owner" text,
	"zero_for_one" boolean,
	"tick_lower" integer,
	"tick_upper" integer,
	"liquidity" numeric(78, 0),
	"amount_in" numeric(78, 0),
	"amount0" numeric(78, 0),
	"amount1" numeric(78, 0),
	"indexed_tick" integer,
	"remaining_liquidity" numeric(78, 0),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"pool_id" varchar(66) NOT NULL,
	"order_id" bigint NOT NULL,
	"owner" text NOT NULL,
	"zero_for_one" boolean NOT NULL,
	"tick_lower" integer NOT NULL,
	"tick_upper" integer NOT NULL,
	"indexed_tick" integer,
	"enable_partial_fill" boolean,
	"liquidity" numeric(78, 0) NOT NULL,
	"remaining_liquidity" numeric(78, 0) NOT NULL,
	"amount_in" numeric(78, 0) NOT NULL,
	"filled_amount0" numeric(78, 0) NOT NULL,
	"filled_amount1" numeric(78, 0) NOT NULL,
	"status" "venue_order_status" DEFAULT 'open' NOT NULL,
	"created_block_number" bigint NOT NULL,
	"created_block_timestamp" timestamp NOT NULL,
	"created_transaction_hash" text NOT NULL,
	"created_log_index" integer NOT NULL,
	"updated_block_number" bigint NOT NULL,
	"updated_log_index" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_pools" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"pool_id" varchar(66) NOT NULL,
	"market_id" bigint NOT NULL,
	"side" "venue_pool_side" NOT NULL,
	"outcome_token" text NOT NULL,
	"postgrad_market" text NOT NULL,
	"outcome_is_currency0" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outcome_token_transfer_events" ADD CONSTRAINT "outcome_token_transfer_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_order_events" ADD CONSTRAINT "venue_order_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outcome_token_balances_chain_token_owner_idx" ON "outcome_token_balances" USING btree ("chain_id","outcome_token","owner");--> statement-breakpoint
CREATE INDEX "outcome_token_balances_chain_owner_idx" ON "outcome_token_balances" USING btree ("chain_id","owner");--> statement-breakpoint
CREATE UNIQUE INDEX "outcome_token_transfer_events_chain_tx_log_idx" ON "outcome_token_transfer_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "outcome_token_transfer_events_chain_token_idx" ON "outcome_token_transfer_events" USING btree ("chain_id","outcome_token");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_order_events_chain_tx_log_idx" ON "venue_order_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "venue_order_events_chain_pool_order_idx" ON "venue_order_events" USING btree ("chain_id","pool_id","order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_orders_chain_pool_order_idx" ON "venue_orders" USING btree ("chain_id","pool_id","order_id");--> statement-breakpoint
CREATE INDEX "venue_orders_chain_pool_status_idx" ON "venue_orders" USING btree ("chain_id","pool_id","status");--> statement-breakpoint
CREATE INDEX "venue_orders_chain_owner_status_idx" ON "venue_orders" USING btree ("chain_id","owner","status");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_pools_chain_pool_idx" ON "venue_pools" USING btree ("chain_id","pool_id");--> statement-breakpoint
CREATE INDEX "venue_pools_chain_market_idx" ON "venue_pools" USING btree ("chain_id","market_id");