-- ADR 0025 P2: pool_price_ticks gains the hook's per-pool swap sequence.
-- Existing rows predate the sequence-bearing event and cannot be backfilled
-- honestly (a fabricated ordinal would defeat the gap detection the column
-- exists for), so they are cleared: every environment with old-format rows is
-- a throwaway devchain — the hook contract has never been durably deployed —
-- and a fresh catch-up sweep repopulates ticks from chains that emit the new
-- event.
TRUNCATE TABLE "pool_price_ticks";--> statement-breakpoint
ALTER TABLE "pool_price_ticks" ADD COLUMN "sequence" bigint NOT NULL;
