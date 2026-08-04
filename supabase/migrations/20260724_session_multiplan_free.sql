-- #249 / #244: a training slot can accept MULTIPLE Square subscription/package
-- plans (not just one), and public sessions can be free ($0).
--
-- Multi-plan is stored as a uuid[] mirroring the team_ids / coach_ids pattern.
-- store_product_id is kept as the primary/legacy column (= store_product_ids[0])
-- so existing reads keep working.
--
-- Free sessions need no schema change: public_price_cents is already a nullable
-- integer, so 0 is a valid value; only the client/edge guards rejected it.

ALTER TABLE training_slots
  ADD COLUMN IF NOT EXISTS store_product_ids uuid[] NOT NULL DEFAULT '{}';

-- Backfill the array from the existing single FK.
UPDATE training_slots
  SET store_product_ids = ARRAY[store_product_id]
  WHERE store_product_id IS NOT NULL
    AND store_product_ids = '{}';
