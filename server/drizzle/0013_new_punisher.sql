CREATE TYPE "public"."resolution_job_status" AS ENUM('queued', 'running', 'succeeded', 'retryable_failed', 'terminal_failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."resolution_job_trigger" AS ENUM('automatic', 'manual', 'retry');--> statement-breakpoint
CREATE TYPE "public"."resolution_outcome" AS ENUM('yes', 'no', 'draw', 'too_early', 'abstain');--> statement-breakpoint
CREATE TYPE "public"."resolution_provider" AS ENUM('anthropic', 'heuristic', 'ollama', 'manual');--> statement-breakpoint
CREATE TYPE "public"."resolution_verdict" AS ENUM('resolve_yes', 'resolve_no', 'cancel_draw', 'requeue_too_early', 'manual_review');--> statement-breakpoint
CREATE TABLE "market_resolution_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"metadata_hash" varchar(66) NOT NULL,
	"status" "resolution_job_status" DEFAULT 'queued' NOT NULL,
	"trigger" "resolution_job_trigger" DEFAULT 'automatic' NOT NULL,
	"requested_provider" "resolution_provider",
	"requested_model" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"not_before" timestamp DEFAULT now() NOT NULL,
	"run_after" timestamp DEFAULT now() NOT NULL,
	"lease_until" timestamp,
	"locked_by" text,
	"last_error" text,
	"resolution_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "market_resolutions" (
	"id" serial PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"market_id" bigint NOT NULL,
	"metadata_hash" varchar(66) NOT NULL,
	"postgrad_market_address" varchar(42),
	"provider" "resolution_provider" NOT NULL,
	"model_id" text,
	"prompt_version" text NOT NULL,
	"outcome" "resolution_outcome" NOT NULL,
	"verdict" "resolution_verdict" NOT NULL,
	"confidence" real,
	"reasons" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"source_checks" jsonb NOT NULL,
	"hard_flags" jsonb NOT NULL,
	"resolved_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_metadata" ADD COLUMN "observation_window_start" timestamp;--> statement-breakpoint
ALTER TABLE "market_metadata" ADD COLUMN "observation_window_end" timestamp;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "yes_not_before" timestamp;--> statement-breakpoint
ALTER TABLE "market_resolution_jobs" ADD CONSTRAINT "market_resolution_jobs_resolution_id_market_resolutions_id_fk" FOREIGN KEY ("resolution_id") REFERENCES "public"."market_resolutions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "market_resolution_jobs" ADD CONSTRAINT "market_resolution_jobs_market_fk" FOREIGN KEY ("chain_id","market_id","metadata_hash") REFERENCES "public"."markets"("chain_id","market_id","metadata_hash") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "market_resolution_jobs" ADD CONSTRAINT "market_resolution_jobs_metadata_fk" FOREIGN KEY ("chain_id","metadata_hash") REFERENCES "public"."market_metadata"("chain_id","metadata_hash") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "market_resolutions" ADD CONSTRAINT "market_resolutions_market_fk" FOREIGN KEY ("chain_id","market_id","metadata_hash") REFERENCES "public"."markets"("chain_id","market_id","metadata_hash") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "market_resolutions" ADD CONSTRAINT "market_resolutions_metadata_fk" FOREIGN KEY ("chain_id","metadata_hash") REFERENCES "public"."market_metadata"("chain_id","metadata_hash") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "market_resolution_jobs_status_run_after_idx" ON "market_resolution_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "market_resolution_jobs_market_idx" ON "market_resolution_jobs" USING btree ("chain_id","market_id","metadata_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "market_resolution_jobs_active_unique_idx" ON "market_resolution_jobs" USING btree ("chain_id","market_id","metadata_hash") WHERE "market_resolution_jobs"."status" in ('queued', 'running', 'retryable_failed');--> statement-breakpoint
CREATE INDEX "market_resolutions_market_latest_idx" ON "market_resolutions" USING btree ("chain_id","market_id","resolved_at");--> statement-breakpoint
CREATE INDEX "market_resolutions_metadata_hash_idx" ON "market_resolutions" USING btree ("chain_id","metadata_hash");