-- Allow prospects to hold multiple positions (#141).
-- Adds positions text[] alongside existing singular position column; backfills from position.

ALTER TABLE public.prospects
  ADD COLUMN IF NOT EXISTS positions text[] DEFAULT '{}'::text[] NOT NULL;

UPDATE public.prospects
SET positions = ARRAY[upper(trim(position))]
WHERE position IS NOT NULL
  AND trim(position) <> ''
  AND (positions IS NULL OR cardinality(positions) = 0);
