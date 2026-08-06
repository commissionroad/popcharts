CREATE TYPE "public"."entry_fee_event_kind" AS ENUM('collected', 'refunded', 'earned');--> statement-breakpoint
CREATE TABLE "entry_fee_withdrawal_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"recipient" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipt_entry_fee_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"receipt_id" bigint NOT NULL,
	"market_id" bigint NOT NULL,
	"kind" "entry_fee_event_kind" NOT NULL,
	"account" text,
	"amount" numeric(78, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "receipt_placed_events_chain_receipt_idx";--> statement-breakpoint
ALTER TABLE "receipt_placed_events" ADD CONSTRAINT "receipt_placed_events_chain_receipt_idx" UNIQUE("chain_id","receipt_id");--> statement-breakpoint
ALTER TABLE "entry_fee_withdrawal_events" ADD CONSTRAINT "entry_fee_withdrawal_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_fee_withdrawal_events" ADD CONSTRAINT "entry_fee_withdrawal_events_market_fk" FOREIGN KEY ("chain_id","market_id") REFERENCES "public"."markets"("chain_id","market_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "receipt_entry_fee_events" ADD CONSTRAINT "receipt_entry_fee_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_entry_fee_events" ADD CONSTRAINT "receipt_entry_fee_events_receipt_fk" FOREIGN KEY ("chain_id","receipt_id") REFERENCES "public"."receipt_placed_events"("chain_id","receipt_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "receipt_entry_fee_events" ADD CONSTRAINT "receipt_entry_fee_events_market_fk" FOREIGN KEY ("chain_id","market_id") REFERENCES "public"."markets"("chain_id","market_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "entry_fee_withdrawal_events_chain_tx_log_idx" ON "entry_fee_withdrawal_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "entry_fee_withdrawal_events_chain_market_idx" ON "entry_fee_withdrawal_events" USING btree ("chain_id","market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_entry_fee_events_chain_tx_log_idx" ON "receipt_entry_fee_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "receipt_entry_fee_events_chain_receipt_idx" ON "receipt_entry_fee_events" USING btree ("chain_id","receipt_id");--> statement-breakpoint
CREATE INDEX "receipt_entry_fee_events_chain_market_idx" ON "receipt_entry_fee_events" USING btree ("chain_id","market_id");
