ALTER TABLE "market_created_events" ADD COLUMN "metadata_uri" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "metadata_uri" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "market_metadata" ADD COLUMN "resolution_sources" jsonb DEFAULT '[]'::jsonb NOT NULL;
