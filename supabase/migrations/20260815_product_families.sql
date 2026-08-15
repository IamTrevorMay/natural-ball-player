-- #276/#305: merge Square's duplicated products.
--
-- WHAT THIS ADDS, IN PLAIN ENGLISH:
-- It adds two new columns to store_products (`family_key`, which is the product
-- name with any trailing "(MONTHLY price)"-style billing-frequency suffix
-- removed, and `canonical_product_id`, which points at the one version of a
-- package that everything else should count as), an index on `family_key`, and
-- a read-only view `product_family_report` that shows every product next to how
-- many purchases and how many training slots point at it.
--
-- WHAT THIS DOES NOT DO, IN PLAIN ENGLISH:
-- It changes no existing product row's name, price, id, Square id, kind, or
-- active flag — it only adds new columns beside them, and it deletes nothing.
--
-- HOW `family_key` IS IMPLEMENTED, AND WHY:
-- As a GENERATED ALWAYS ... STORED column. The whole expression
-- (regexp_replace + regexp_replace + btrim + lower) is built from IMMUTABLE
-- functions, which is the only thing Postgres requires for a stored generated
-- column, so no backfill UPDATE and no trigger are needed: existing rows are
-- filled in when the column is added, and future inserts/renames stay correct
-- for free. A generated column also cannot be written to by hand, so the SQL
-- rule can never drift away from the JS rule in src/productFamily.js — the two
-- expressions are deliberately character-for-character equivalent (strip the
-- suffix, collapse runs of whitespace, trim, lowercase).
-- Adding a stored generated column rewrites the table; store_products holds
-- ~100 rows, so this is a sub-second rewrite. Postgres does NOT re-validate
-- pre-existing CHECK constraints during that rewrite, so rows that predate
-- current constraints are unaffected.
--
-- WRITES ARE ADMIN-ONLY: `family_key` is generated and therefore not writable
-- by anyone, and `canonical_product_id` is covered by the existing admin-only
-- store_products UPDATE policy, which this migration re-asserts unchanged (same
-- shape as supabase/migrations/20260616_rls_to_authenticated.sql).
--
-- This file is idempotent — running it twice is a no-op.

-- ---------------------------------------------------------------------------
-- 1. canonical_product_id: NULL means "this IS the canonical version / not
--    merged into anything". A non-NULL value points at the sibling row that
--    this duplicate should be treated as. ON DELETE SET NULL so deleting a
--    product can never orphan a dangling pointer.
-- ---------------------------------------------------------------------------
ALTER TABLE public.store_products
  ADD COLUMN IF NOT EXISTS canonical_product_id uuid
    REFERENCES public.store_products(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.store_products.canonical_product_id IS
  '#276/#305: the version of this package that purchases and tagged sessions should count as. NULL = this row is the canonical version.';

-- ---------------------------------------------------------------------------
-- 2. family_key: the product name with a trailing "(<FREQUENCY> price)" suffix
--    stripped, whitespace runs collapsed, trimmed, lowercased. Mirrors
--    familyKey() in src/productFamily.js exactly.
--
--    ADD COLUMN ... GENERATED has no IF NOT EXISTS form that accepts a
--    generation expression on every supported version, so guard it explicitly.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'store_products'
      AND column_name  = 'family_key'
  ) THEN
    ALTER TABLE public.store_products
      ADD COLUMN family_key text
      GENERATED ALWAYS AS (
        lower(
          btrim(
            regexp_replace(
              regexp_replace(name, '\s*\(\s*[A-Za-z][A-Za-z_]*\s+price\s*\)\s*$', '', 'i'),
              '\s+', ' ', 'g'
            )
          )
        )
      ) STORED;
  END IF;
END $$;

COMMENT ON COLUMN public.store_products.family_key IS
  '#276/#305: product name with any trailing "(FREQUENCY price)" suffix removed, whitespace collapsed, lowercased. Two rows sharing a family_key are the same real-world package. Mirrors familyKey() in src/productFamily.js.';

CREATE INDEX IF NOT EXISTS store_products_family_key_idx
  ON public.store_products (family_key);

-- ---------------------------------------------------------------------------
-- 3. product_family_report: read-only helper view mirroring the CSV the admin
--    screen exports, so the same numbers can be checked from the SQL editor.
--    security_invoker = true so the caller's RLS applies (store_purchases is
--    player-scoped; without this the view would leak every purchase).
--    It joins three tables, so it is not auto-updatable — reads only.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.product_family_report;

CREATE VIEW public.product_family_report
WITH (security_invoker = true) AS
SELECT
  p.family_key                          AS family,
  p.name                                AS product_name,
  p.kind                                AS kind,
  p.active                              AS active,
  p.bundle_qty                          AS bundle_qty,
  (p.price_cents::numeric / 100)        AS price,
  COALESCE(pu.cnt, 0)                   AS purchases,
  COALESCE(sl.cnt, 0)                   AS slots_tagged,
  (p.canonical_product_id IS NULL)      AS is_canonical
FROM public.store_products p
LEFT JOIN LATERAL (
  SELECT count(*) AS cnt
  FROM public.store_purchases sp
  WHERE sp.product_id = p.id
) pu ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS cnt
  FROM public.training_slots ts
  WHERE ts.store_product_id = p.id
     OR p.id = ANY (ts.store_product_ids)
) sl ON true;

COMMENT ON VIEW public.product_family_report IS
  '#276/#305: read-only. One row per store_product with its purchase and tagged-session counts. is_canonical is true when canonical_product_id IS NULL, i.e. the row has not been merged into a sibling. Order by family to see duplicates side by side.';

REVOKE ALL   ON public.product_family_report FROM anon;
GRANT  SELECT ON public.product_family_report TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS. store_products already has RLS enabled and an admin-only write
--    policy; new columns inherit it. Re-asserted verbatim (same shape as
--    20260616_rls_to_authenticated.sql) so this migration is self-documenting
--    about who may write canonical_product_id: admins, nobody else.
--    No new GRANT is needed — store_products is already granted to
--    `authenticated` and gated by these policies.
-- ---------------------------------------------------------------------------
ALTER TABLE public.store_products ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_products_select" ON public.store_products;
DROP POLICY IF EXISTS "store_products_insert" ON public.store_products;
DROP POLICY IF EXISTS "store_products_update" ON public.store_products;
DROP POLICY IF EXISTS "store_products_delete" ON public.store_products;

CREATE POLICY "store_products_select" ON public.store_products
  FOR SELECT TO authenticated
  USING (active = true OR public.get_user_role() = 'admin');
CREATE POLICY "store_products_insert" ON public.store_products
  FOR INSERT TO authenticated WITH CHECK (public.get_user_role() = 'admin');
CREATE POLICY "store_products_update" ON public.store_products
  FOR UPDATE TO authenticated
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');
CREATE POLICY "store_products_delete" ON public.store_products
  FOR DELETE TO authenticated USING (public.get_user_role() = 'admin');
