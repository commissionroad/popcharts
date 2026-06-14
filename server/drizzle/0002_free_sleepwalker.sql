CREATE TABLE "market_metadata" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"metadata_hash" varchar(66) NOT NULL,
	"question" text NOT NULL,
	"description" text NOT NULL,
	"category" varchar(40) NOT NULL,
	"resolution_criteria" text NOT NULL,
	"resolution_url" text,
	"metadata_created_at" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "market_metadata_chain_hash_idx" ON "market_metadata" USING btree ("chain_id","metadata_hash");