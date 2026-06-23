CREATE TYPE "public"."ai_review_job_status" AS ENUM('queued', 'running', 'succeeded', 'retryable_failed', 'terminal_failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ai_review_job_trigger" AS ENUM('automatic', 'manual', 'retry');--> statement-breakpoint
CREATE TABLE "market_ai_review_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"metadata_hash" varchar(66) NOT NULL,
	"status" "ai_review_job_status" DEFAULT 'queued' NOT NULL,
	"trigger" "ai_review_job_trigger" DEFAULT 'automatic' NOT NULL,
	"requested_provider" "ai_review_provider",
	"requested_model" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp DEFAULT now() NOT NULL,
	"lease_until" timestamp,
	"locked_by" text,
	"last_error" text,
	"review_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "market_ai_review_jobs" ADD CONSTRAINT "market_ai_review_jobs_review_id_market_ai_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."market_ai_reviews"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "market_ai_review_jobs" ADD CONSTRAINT "market_ai_review_jobs_market_fk" FOREIGN KEY ("chain_id","market_id","metadata_hash") REFERENCES "public"."markets"("chain_id","market_id","metadata_hash") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "market_ai_review_jobs" ADD CONSTRAINT "market_ai_review_jobs_metadata_fk" FOREIGN KEY ("chain_id","metadata_hash") REFERENCES "public"."market_metadata"("chain_id","metadata_hash") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "market_ai_review_jobs_status_run_after_idx" ON "market_ai_review_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "market_ai_review_jobs_market_idx" ON "market_ai_review_jobs" USING btree ("chain_id","market_id","metadata_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "market_ai_review_jobs_active_unique_idx" ON "market_ai_review_jobs" USING btree ("chain_id","market_id","metadata_hash") WHERE "market_ai_review_jobs"."status" in ('queued', 'running', 'retryable_failed');