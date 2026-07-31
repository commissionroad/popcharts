CREATE TYPE "public"."market_draft_status" AS ENUM('editing', 'in_review', 'changes_requested', 'rejected', 'approved', 'published');--> statement-breakpoint
CREATE TYPE "public"."market_draft_visibility" AS ENUM('private');--> statement-breakpoint
CREATE TABLE "market_draft_review_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer NOT NULL,
	"metadata_hash" varchar(66) NOT NULL,
	"status" "ai_review_job_status" DEFAULT 'queued' NOT NULL,
	"trigger" "ai_review_job_trigger" DEFAULT 'automatic' NOT NULL,
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
CREATE TABLE "market_draft_reviews" (
	"id" serial PRIMARY KEY NOT NULL,
	"draft_id" integer NOT NULL,
	"metadata_hash" varchar(66) NOT NULL,
	"provider" "ai_review_provider" NOT NULL,
	"model_id" text,
	"prompt_version" text NOT NULL,
	"verdict" "ai_review_verdict" NOT NULL,
	"scores" jsonb NOT NULL,
	"hard_flags" jsonb NOT NULL,
	"reasons" jsonb NOT NULL,
	"score_rationales" jsonb NOT NULL,
	"source_checks" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"feedback" jsonb NOT NULL,
	"reviewed_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_drafts" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"intended_creator_address" varchar(42),
	"question" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" varchar(40) DEFAULT 'Crypto' NOT NULL,
	"outcome_yes" text DEFAULT '' NOT NULL,
	"outcome_no" text DEFAULT '' NOT NULL,
	"resolution_criteria" text DEFAULT '' NOT NULL,
	"resolution_sources" text DEFAULT '' NOT NULL,
	"resolution_url" text DEFAULT '' NOT NULL,
	"opening_probability" integer DEFAULT 50 NOT NULL,
	"liquidity_parameter" integer DEFAULT 5000 NOT NULL,
	"graduation_window_seconds" integer DEFAULT 3600 NOT NULL,
	"resolution_window_seconds" integer DEFAULT 604800 NOT NULL,
	"status" "market_draft_status" DEFAULT 'editing' NOT NULL,
	"is_template" boolean DEFAULT false NOT NULL,
	"visibility" "market_draft_visibility" DEFAULT 'private' NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"submitted_metadata_hash" varchar(66),
	"published_chain_id" integer,
	"published_market_id" bigint,
	"published_transaction_hash" varchar(66),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"submitted_at" timestamp,
	"reviewed_at" timestamp,
	"published_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "market_draft_review_jobs" ADD CONSTRAINT "market_draft_review_jobs_draft_id_market_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."market_drafts"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "market_draft_review_jobs" ADD CONSTRAINT "market_draft_review_jobs_review_id_market_draft_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."market_draft_reviews"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "market_draft_reviews" ADD CONSTRAINT "market_draft_reviews_draft_id_market_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."market_drafts"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "market_draft_review_jobs_status_run_after_idx" ON "market_draft_review_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "market_draft_review_jobs_draft_idx" ON "market_draft_review_jobs" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "market_draft_reviews_draft_latest_idx" ON "market_draft_reviews" USING btree ("draft_id","reviewed_at");--> statement-breakpoint
CREATE INDEX "market_drafts_owner_idx" ON "market_drafts" USING btree ("owner_user_id","deleted","updated_at");--> statement-breakpoint
CREATE INDEX "market_drafts_status_idx" ON "market_drafts" USING btree ("status");