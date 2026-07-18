-- Add a DEFERRED backlog status so scope can be consciously descoped at closeout.
-- Additive enum value (PG18 allows ADD VALUE inside the migration transaction as long as
-- the new value is not referenced in the same transaction — it isn't here).
ALTER TYPE "BacklogStatus" ADD VALUE 'DEFERRED';
