-- Issue #142 follow-up: Square Catalog Discount objects + admin "apply to
-- player's subscription" flow. Discounts are synced from Square and applied
-- to a player's active Square subscription as a price_override_money override.

CREATE TABLE IF NOT EXISTS public.store_discounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  square_catalog_id text NOT NULL UNIQUE,
  name              text NOT NULL,
  percentage        numeric(5,2),
  amount_cents      integer CHECK (amount_cents IS NULL OR amount_cents >= 0),
  active            boolean NOT NULL DEFAULT true,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS applied_discount_id    uuid REFERENCES public.store_discounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS discounted_price_cents integer;

ALTER TABLE public.store_discounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "store_discounts_select" ON public.store_discounts;
CREATE POLICY "store_discounts_select" ON public.store_discounts
  FOR SELECT
  USING (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "store_discounts_write_admin" ON public.store_discounts;
CREATE POLICY "store_discounts_write_admin" ON public.store_discounts
  FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_discounts TO authenticated;
GRANT ALL                            ON public.store_discounts TO service_role;
