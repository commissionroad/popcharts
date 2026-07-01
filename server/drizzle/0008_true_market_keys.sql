ALTER TABLE "contracts" ADD CONSTRAINT "contracts_address_chain_idx" UNIQUE USING INDEX "contracts_address_chain_idx";--> statement-breakpoint
ALTER TABLE "market_metadata" ADD CONSTRAINT "market_metadata_chain_hash_idx" UNIQUE USING INDEX "market_metadata_chain_hash_idx";--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_chain_market_idx" UNIQUE USING INDEX "markets_chain_market_idx";--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_chain_market_hash_idx" UNIQUE USING INDEX "markets_chain_market_hash_idx";--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_created_tx_log_idx" UNIQUE USING INDEX "markets_created_tx_log_idx";
