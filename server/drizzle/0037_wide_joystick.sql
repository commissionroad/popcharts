-- Draft public ids (ADR 0022): the identifier the API and the create-flow URL
-- speak, replacing the exposed serial id. Added in four steps because the
-- generated one-liner (ADD COLUMN ... NOT NULL, no default) cannot apply to a
-- table that already has rows.
--
-- The alphabet is repeated here rather than imported: a migration is a frozen
-- historical artifact and has to keep meaning the same thing even if
-- src/drafts/public-id.ts later changes. It must match that module's ALPHABET
-- at the time of writing — 32 lowercase alphanumerics with 0/1/l/o removed.
ALTER TABLE "market_drafts" ADD COLUMN "public_id" varchar(16);--> statement-breakpoint

-- Row-at-a-time so random() is re-evaluated per draft. A set-based UPDATE with
-- an uncorrelated scalar subquery would compute one id and write it to every
-- row, which the unique index below would then reject.
DO $$
DECLARE
  target RECORD;
BEGIN
  FOR target IN SELECT id FROM market_drafts WHERE public_id IS NULL LOOP
    UPDATE market_drafts
    SET public_id = (
      SELECT string_agg(
        substr('23456789abcdefghijkmnpqrstuvwxyz', 1 + floor(random() * 32)::int, 1),
        ''
      )
      FROM generate_series(1, 16)
    )
    WHERE id = target.id;
  END LOOP;
END $$;--> statement-breakpoint

ALTER TABLE "market_drafts" ALTER COLUMN "public_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "market_drafts" ADD CONSTRAINT "market_drafts_public_id_unique" UNIQUE("public_id");
