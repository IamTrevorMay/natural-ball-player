-- Issues #235 / #238: package / bundle session tracking. Surfaces "sessions
-- left", "when each session was used", and "time left in the package" on the
-- player profile (#235) and in a per-package admin overview (#238).
--
-- store_purchases already tracks remaining_qty. This adds:
--   * expires_at on the purchase (time-sensitive, non-monthly packages)
--   * store_session_usage: one row per session consumed, so staff can see the
--     usage history and which booking it was tied to.

ALTER TABLE public.store_purchases
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

CREATE TABLE IF NOT EXISTS public.store_session_usage (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id  uuid NOT NULL REFERENCES public.store_purchases(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  used_on      date NOT NULL DEFAULT current_date,
  source_type  text,          -- 'training_slot' | 'facility_event' | 'manual'
  source_id    uuid,          -- reservation / event id when tied to a booking
  note         text,
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS store_session_usage_purchase_idx
  ON public.store_session_usage (purchase_id, used_on DESC);
CREATE INDEX IF NOT EXISTS store_session_usage_user_idx
  ON public.store_session_usage (user_id, used_on DESC);

-- Extend store_purchases read access to coaches so trainers can see a player's
-- packages on their profile (previously player-own + admin only).
DROP POLICY IF EXISTS "store_purchases_select" ON public.store_purchases;
CREATE POLICY "store_purchases_select" ON public.store_purchases
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.get_user_role() IN ('admin', 'coach')
  );

-- Staff (admin + coach) can also update purchases (e.g. adjust remaining_qty /
-- expiry from the profile); previously admin-only.
DROP POLICY IF EXISTS "store_purchases_update_admin" ON public.store_purchases;
CREATE POLICY "store_purchases_update_staff" ON public.store_purchases
  FOR UPDATE
  USING (public.get_user_role() IN ('admin', 'coach'))
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

-- store_session_usage RLS: player reads own; staff read/write all.
ALTER TABLE public.store_session_usage ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "session_usage_select" ON public.store_session_usage;
CREATE POLICY "session_usage_select" ON public.store_session_usage
  FOR SELECT
  USING (user_id = auth.uid() OR public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "session_usage_insert" ON public.store_session_usage;
CREATE POLICY "session_usage_insert" ON public.store_session_usage
  FOR INSERT
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "session_usage_update" ON public.store_session_usage;
CREATE POLICY "session_usage_update" ON public.store_session_usage
  FOR UPDATE
  USING (public.get_user_role() IN ('admin', 'coach'))
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "session_usage_delete" ON public.store_session_usage;
CREATE POLICY "session_usage_delete" ON public.store_session_usage
  FOR DELETE
  USING (public.get_user_role() IN ('admin', 'coach'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_session_usage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_session_usage TO service_role;
