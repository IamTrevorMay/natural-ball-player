-- Issue: discount_codes.player_id was added (2026-06-12) but the SELECT policy
-- stayed `USING (true)`, so any authenticated player could read every other
-- player's per-athlete code. Restrict SELECT so players see only codes that
-- target them (or are unscoped/global); staff still see everything.

DROP POLICY IF EXISTS "Anyone can view discount codes" ON public.discount_codes;
CREATE POLICY "Discount codes visibility" ON public.discount_codes
  FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() IN ('admin', 'coach')
    OR player_id IS NULL
    OR player_id = auth.uid()
  );
