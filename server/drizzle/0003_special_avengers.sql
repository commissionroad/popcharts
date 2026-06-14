CREATE TABLE "receipt_placed_events" (
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
	"shares" numeric(78, 0) NOT NULL,
	"cost" numeric(78, 0) NOT NULL,
	"r_low" text NOT NULL,
	"r_high" text NOT NULL,
	"sequence" bigint NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "receipt_placed_events" ADD CONSTRAINT "receipt_placed_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_placed_events_chain_tx_log_idx" ON "receipt_placed_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_placed_events_chain_receipt_idx" ON "receipt_placed_events" USING btree ("chain_id","receipt_id");