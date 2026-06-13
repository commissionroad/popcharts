ALTER TABLE "market_created_events" ALTER COLUMN "opening_probability_wad" SET DATA TYPE numeric(78, 0);--> statement-breakpoint
ALTER TABLE "market_created_events" ALTER COLUMN "liquidity_parameter" SET DATA TYPE numeric(78, 0);--> statement-breakpoint
ALTER TABLE "market_created_events" ALTER COLUMN "graduation_threshold" SET DATA TYPE numeric(78, 0);--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "opening_probability_wad" SET DATA TYPE numeric(78, 0);--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "liquidity_parameter" SET DATA TYPE numeric(78, 0);--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "graduation_threshold" SET DATA TYPE numeric(78, 0);--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "receipt_count" SET DATA TYPE numeric(78, 0);--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "total_escrowed" SET DATA TYPE numeric(78, 0);--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "yes_shares" SET DATA TYPE numeric(78, 0);--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "no_shares" SET DATA TYPE numeric(78, 0);