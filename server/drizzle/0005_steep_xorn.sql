ALTER TYPE "public"."market_status" ADD VALUE 'under_review' BEFORE 'bootstrap';--> statement-breakpoint
ALTER TYPE "public"."market_status" ADD VALUE 'rejected';--> statement-breakpoint
COMMIT;--> statement-breakpoint
BEGIN;
