CREATE TABLE "pool_price_ticks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"contract_id" integer NOT NULL,
	"block_number" bigint NOT NULL,
	"block_timestamp" timestamp NOT NULL,
	"transaction_hash" text NOT NULL,
	"log_index" integer NOT NULL,
	"pool_id" varchar(66) NOT NULL,
	"tick" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pool_price_ticks" ADD CONSTRAINT "pool_price_ticks_contract_id_contracts_id_fk" FOREIGN KEY ("contract_id") REFERENCES "public"."contracts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pool_price_ticks_chain_tx_log_idx" ON "pool_price_ticks" USING btree ("chain_id","transaction_hash","log_index");--> statement-breakpoint
CREATE INDEX "pool_price_ticks_chain_pool_time_idx" ON "pool_price_ticks" USING btree ("chain_id","pool_id","block_timestamp","log_index");