CREATE TYPE "public"."withdrawal_config_kind" AS ENUM('fee_rate', 'challenge_period');--> statement-breakpoint
CREATE TYPE "public"."withdrawal_event_kind" AS ENUM('requested', 'refuted', 'finalized', 'voided');--> statement-breakpoint
CREATE TABLE "receipt_withdrawal_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"request_id" bigint NOT NULL,
	"receipt_id" bigint NOT NULL,
	"market_id" bigint NOT NULL,
	"kind" "withdrawal_event_kind" NOT NULL,
	"account" text,
	"segments" text,
	"gross_refund" numeric(78, 0),
	"withdrawal_fee" numeric(78, 0),
	"entry_fee_refund" numeric(78, 0),
	"escrow_refund" numeric(78, 0),
	"challenge_deadline_unix" bigint,
	"challenge_deadline" timestamp,
	"next_receipt_id_snapshot" bigint,
	"refuting_receipt_id" bigint,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawal_config_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"kind" "withdrawal_config_kind" NOT NULL,
	"previous_value" numeric(78, 0) NOT NULL,
	"new_value" numeric(78, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "withdrawal_fee_withdrawal_events" (
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
ALTER TABLE "receipt_withdrawal_events" ADD CONSTRAINT "receipt_withdrawal_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_withdrawal_events" ADD CONSTRAINT "receipt_withdrawal_events_receipt_fk" FOREIGN KEY ("chain_id","receipt_id") REFERENCES "public"."receipt_placed_events"("chain_id","receipt_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "receipt_withdrawal_events" ADD CONSTRAINT "receipt_withdrawal_events_market_fk" FOREIGN KEY ("chain_id","market_id") REFERENCES "public"."markets"("chain_id","market_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "receipt_withdrawal_events" ADD CONSTRAINT "receipt_withdrawal_events_refuting_receipt_fk" FOREIGN KEY ("chain_id","refuting_receipt_id") REFERENCES "public"."receipt_placed_events"("chain_id","receipt_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "withdrawal_config_events" ADD CONSTRAINT "withdrawal_config_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_fee_withdrawal_events" ADD CONSTRAINT "withdrawal_fee_withdrawal_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "withdrawal_fee_withdrawal_events" ADD CONSTRAINT "withdrawal_fee_withdrawal_events_market_fk" FOREIGN KEY ("chain_id","market_id") REFERENCES "public"."markets"("chain_id","market_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_withdrawal_events_chain_tx_log_idx" ON "receipt_withdrawal_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "receipt_withdrawal_events_chain_request_idx" ON "receipt_withdrawal_events" USING btree ("chain_id","request_id");--> statement-breakpoint
CREATE INDEX "receipt_withdrawal_events_chain_receipt_idx" ON "receipt_withdrawal_events" USING btree ("chain_id","receipt_id");--> statement-breakpoint
CREATE INDEX "receipt_withdrawal_events_chain_market_idx" ON "receipt_withdrawal_events" USING btree ("chain_id","market_id");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawal_config_events_chain_tx_log_idx" ON "withdrawal_config_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "withdrawal_fee_withdrawal_events_chain_tx_log_idx" ON "withdrawal_fee_withdrawal_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "withdrawal_fee_withdrawal_events_chain_market_idx" ON "withdrawal_fee_withdrawal_events" USING btree ("chain_id","market_id");