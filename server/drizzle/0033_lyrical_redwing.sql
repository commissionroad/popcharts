CREATE TABLE "market_creation_fee_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"creator" text NOT NULL,
	"amount" numeric(78, 0) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_creation_fee_events" ADD CONSTRAINT "market_creation_fee_events_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_creation_fee_events" ADD CONSTRAINT "market_creation_fee_events_market_fk" FOREIGN KEY ("chain_id","market_id") REFERENCES "public"."markets"("chain_id","market_id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "market_creation_fee_events_chain_tx_log_idx" ON "market_creation_fee_events" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "market_creation_fee_events_chain_market_idx" ON "market_creation_fee_events" USING btree ("chain_id","market_id");--> statement-breakpoint
CREATE INDEX "market_creation_fee_events_chain_creator_idx" ON "market_creation_fee_events" USING btree ("chain_id","creator");