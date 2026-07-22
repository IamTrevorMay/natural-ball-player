-- #244: mark a training slot as a "subscription session" tied to a Square
-- subscription/package product, instead of typing a one-off public price.
-- Anyone with that (or any) active subscription/package can join; gating is
-- advisory in the booking UI (warn-only). No new RLS/grants — training_slots
-- is already granted, and store_products is readable by all authenticated users.

ALTER TABLE public.training_slots
  ADD COLUMN IF NOT EXISTS is_subscription_session boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS store_product_id uuid REFERENCES public.store_products(id) ON DELETE SET NULL;
