DROP INDEX "draft_review_charges_address_settled_idx";--> statement-breakpoint
CREATE INDEX "draft_review_charges_address_idx" ON "draft_review_charges" USING btree ("charged_address");--> statement-breakpoint
ALTER TABLE "draft_review_charges" DROP COLUMN "settled_at";