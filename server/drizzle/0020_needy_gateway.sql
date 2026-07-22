CREATE TABLE "change_feed" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"source_table" text NOT NULL,
	"op" text NOT NULL,
	"row_id" text,
	"chain_id" integer,
	"market_id" text,
	"owner" text,
	"block_number" bigint,
	"log_index" integer
);
--> statement-breakpoint
CREATE INDEX "change_feed_created_at_idx" ON "change_feed" USING btree ("created_at");