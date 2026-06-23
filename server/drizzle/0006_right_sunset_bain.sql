CREATE TYPE "public"."ai_review_provider" AS ENUM('anthropic', 'heuristic', 'ollama');--> statement-breakpoint
CREATE TYPE "public"."ai_review_verdict" AS ENUM('approve', 'reject', 'manual_review');--> statement-breakpoint
CREATE UNIQUE INDEX "markets_chain_market_hash_idx" ON "markets" USING btree ("chain_id","market_id","metadata_hash");--> statement-breakpoint
CREATE TABLE "market_ai_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"metadata_hash" varchar(66) NOT NULL,
	"provider" "ai_review_provider" NOT NULL,
	"model_id" text,
	"prompt_version" text NOT NULL,
	"verdict" "ai_review_verdict" NOT NULL,
	"scores" jsonb NOT NULL,
	"hard_flags" jsonb NOT NULL,
	"reasons" jsonb NOT NULL,
	"source_checks" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"reviewed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_ai_reviews" ADD CONSTRAINT "market_ai_reviews_market_fk" FOREIGN KEY ("chain_id","market_id","metadata_hash") REFERENCES "public"."markets"("chain_id","market_id","metadata_hash") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "market_ai_reviews" ADD CONSTRAINT "market_ai_reviews_metadata_fk" FOREIGN KEY ("chain_id","metadata_hash") REFERENCES "public"."market_metadata"("chain_id","metadata_hash") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "market_ai_reviews_market_latest_idx" ON "market_ai_reviews" USING btree ("chain_id","market_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "market_ai_reviews_metadata_hash_idx" ON "market_ai_reviews" USING btree ("chain_id","metadata_hash");
