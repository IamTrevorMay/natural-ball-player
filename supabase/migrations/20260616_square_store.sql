-- Issue #142: Square store integration. Catalog of products (lessons / monthly
-- packages / lesson bundles / cage rentals) and purchase ledger. Purchases are
-- created server-side by the `square-checkout` edge function and updated by
-- the `square-webhook` function as Square fires payment/subscription events.

CREATE TABLE IF NOT EXISTS public.store_products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            text NOT NULL CHECK (kind IN ('lesson', 'package', 'bundle', 'rental')),
  name            text NOT NULL,
  description     text,
  price_cents     integer NOT NULL CHECK (price_cents >= 0),
  recurring       boolean NOT NULL DEFAULT false,
  bundle_qty      integer CHECK (bundle_qty IS NULL OR bundle_qty > 0),
  square_catalog_id   text,
  square_plan_id      text,
  square_variation_id text,
  active          boolean NOT NULL DEFAULT true,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recurring_only_for_package CHECK (
    (recurring = false) OR (kind = 'package')
  ),
  CONSTRAINT bundle_qty_only_for_bundle CHECK (
    (bundle_qty IS NULL) OR (kind = 'bundle')
  )
);

CREATE INDEX IF NOT EXISTS store_products_active_idx
  ON public.store_products (active, kind, sort_order);

CREATE TABLE IF NOT EXISTS public.store_purchases (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  product_id            uuid REFERENCES public.store_products(id) ON DELETE SET NULL,
  product_kind          text NOT NULL,
  product_name_snapshot text NOT NULL,
  amount_cents          integer NOT NULL CHECK (amount_cents >= 0),
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'canceled', 'active', 'past_due')),
  square_order_id        text,
  square_payment_id      text,
  square_subscription_id text,
  square_customer_id     text,
  remaining_qty         integer,
  checkout_url          text,
  metadata              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  paid_at               timestamptz
);

CREATE INDEX IF NOT EXISTS store_purchases_user_idx
  ON public.store_purchases (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS store_purchases_status_idx
  ON public.store_purchases (status);
CREATE UNIQUE INDEX IF NOT EXISTS store_purchases_square_payment_uniq
  ON public.store_purchases (square_payment_id)
  WHERE square_payment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS store_purchases_square_subscription_uniq
  ON public.store_purchases (square_subscription_id)
  WHERE square_subscription_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.store_webhook_events (
  event_id      text PRIMARY KEY,
  event_type    text NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  payload       jsonb NOT NULL
);

-- updated_at maintenance
CREATE OR REPLACE FUNCTION public.store_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_store_products_touch ON public.store_products;
CREATE TRIGGER trg_store_products_touch
  BEFORE UPDATE ON public.store_products
  FOR EACH ROW EXECUTE FUNCTION public.store_touch_updated_at();

DROP TRIGGER IF EXISTS trg_store_purchases_touch ON public.store_purchases;
CREATE TRIGGER trg_store_purchases_touch
  BEFORE UPDATE ON public.store_purchases
  FOR EACH ROW EXECUTE FUNCTION public.store_touch_updated_at();

-- RLS
ALTER TABLE public.store_products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_purchases      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_webhook_events ENABLE ROW LEVEL SECURITY;

-- store_products: everyone authenticated reads active products; admin full CRUD
DROP POLICY IF EXISTS "store_products_select" ON public.store_products;
CREATE POLICY "store_products_select" ON public.store_products
  FOR SELECT
  USING (active = true OR public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "store_products_insert" ON public.store_products;
CREATE POLICY "store_products_insert" ON public.store_products
  FOR INSERT
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "store_products_update" ON public.store_products;
CREATE POLICY "store_products_update" ON public.store_products
  FOR UPDATE
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "store_products_delete" ON public.store_products;
CREATE POLICY "store_products_delete" ON public.store_products
  FOR DELETE
  USING (public.get_user_role() = 'admin');

-- store_purchases: player reads own; admin reads/writes all; inserts/updates
-- come from the edge function (service role bypasses RLS), so no player-write
-- policy here.
DROP POLICY IF EXISTS "store_purchases_select" ON public.store_purchases;
CREATE POLICY "store_purchases_select" ON public.store_purchases
  FOR SELECT
  USING (user_id = auth.uid() OR public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "store_purchases_update_admin" ON public.store_purchases;
CREATE POLICY "store_purchases_update_admin" ON public.store_purchases
  FOR UPDATE
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

DROP POLICY IF EXISTS "store_purchases_delete_admin" ON public.store_purchases;
CREATE POLICY "store_purchases_delete_admin" ON public.store_purchases
  FOR DELETE
  USING (public.get_user_role() = 'admin');

-- store_webhook_events: admin read only; writes happen via service role
DROP POLICY IF EXISTS "store_webhook_events_select" ON public.store_webhook_events;
CREATE POLICY "store_webhook_events_select" ON public.store_webhook_events
  FOR SELECT
  USING (public.get_user_role() = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_products       TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_purchases      TO authenticated;
GRANT SELECT                          ON public.store_webhook_events TO authenticated;
