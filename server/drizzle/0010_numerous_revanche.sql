ALTER TABLE "market_created_events" ADD COLUMN "metadata_uri" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "metadata_uri" text DEFAULT '' NOT NULL;
