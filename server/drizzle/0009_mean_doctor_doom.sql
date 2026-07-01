CREATE TABLE "clearing_root_submitted_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"submitter" text NOT NULL,
	"merkle_root" varchar(66) NOT NULL,
	"snapshot_hash" varchar(66) NOT NULL,
	"matched_market_cap" numeric(78, 0) NOT NULL,
	"retained_cost_total" numeric(78, 0) NOT NULL,
	"refund_total" numeric(78, 0) NOT NULL,
	"complete_set_count" numeric(78, 0) NOT NULL,
	"submitted_at_unix" bigint NOT NULL,
	"submitted_at" timestamp NOT NULL,
	"challenge_deadline_unix" bigint NOT NULL,
	"challenge_deadline" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graduated_receipt_claimed_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"receipt_id" bigint NOT NULL,
	"market_id" bigint NOT NULL,
	"owner" text NOT NULL,
	"side" integer NOT NULL,
	"retained_shares" numeric(78, 0) NOT NULL,
	"retained_cost" numeric(78, 0) NOT NULL,
	"refund" numeric(78, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graduation_finalized_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"postgrad_adapter" text NOT NULL,
	"postgrad_market" text NOT NULL,
	"complete_set_count" numeric(78, 0) NOT NULL,
	"retained_cost_total" numeric(78, 0) NOT NULL,
	"refund_total" numeric(78, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graduation_started_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"manager" text NOT NULL,
	"receipt_count" numeric(78, 0) NOT NULL,
	"total_escrowed" numeric(78, 0) NOT NULL,
	"path" text NOT NULL,
	"yes_shares" numeric(78, 0) NOT NULL,
	"no_shares" numeric(78, 0) NOT NULL,
	"graduation_started_at_unix" bigint NOT NULL,
	"graduation_started_at" timestamp NOT NULL,
	"snapshot_hash" varchar(66) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_refunds_available_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"total_escrowed" numeric(78, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refunded_receipt_claimed_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"receipt_id" bigint NOT NULL,
	"market_id" bigint NOT NULL,
	"owner" text NOT NULL,
	"refund" numeric(78, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clearing_root_submitted_events" ADD CONSTRAINT "clearing_root_submitted_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graduated_receipt_claimed_events" ADD CONSTRAINT "graduated_receipt_claimed_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graduation_finalized_events" ADD CONSTRAINT "graduation_finalized_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graduation_started_events" ADD CONSTRAINT "graduation_started_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_refunds_available_events" ADD CONSTRAINT "market_refunds_available_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunded_receipt_claimed_events" ADD CONSTRAINT "refunded_receipt_claimed_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clearing_root_submitted_events_chain_tx_log_idx" ON "clearing_root_submitted_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "graduated_receipt_claimed_events_chain_tx_log_idx" ON "graduated_receipt_claimed_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "graduated_receipt_claimed_events_chain_receipt_idx" ON "graduated_receipt_claimed_events" USING btree ("chain_id","receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "graduation_finalized_events_chain_tx_log_idx" ON "graduation_finalized_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "graduation_started_events_chain_tx_log_idx" ON "graduation_started_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "market_refunds_available_events_chain_tx_log_idx" ON "market_refunds_available_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "refunded_receipt_claimed_events_chain_tx_log_idx" ON "refunded_receipt_claimed_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "refunded_receipt_claimed_events_chain_receipt_idx" ON "refunded_receipt_claimed_events" USING btree ("chain_id","receipt_id");