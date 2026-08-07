CREATE TYPE "public"."resolution_commit_state" AS ENUM('pending', 'confirmed');--> statement-breakpoint
ALTER TABLE "market_resolutions" ALTER COLUMN "resolved_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "market_resolutions" ALTER COLUMN "resolved_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "market_resolutions" ADD COLUMN "commit_state" "resolution_commit_state" DEFAULT 'confirmed' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "market_resolutions_pending_unique_idx" ON "market_resolutions" USING btree ("chain_id","market_id","metadata_hash") WHERE "market_resolutions"."commit_state" = 'pending';