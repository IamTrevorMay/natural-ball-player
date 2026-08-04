-- All staff (admin + coach) can view slot reservations, so any coach can see
-- who's booked in another coach's slots (read-only in the UI). Managing a
-- reservation (UPDATE) is unchanged: the player, the slot's coach, or admin.
DROP POLICY IF EXISTS "Relevant users can view reservations" ON public.slot_reservations;
CREATE POLICY "Players and staff can view reservations" ON public.slot_reservations
  FOR SELECT USING (
    player_id = auth.uid()
    OR public.get_user_role() IN ('admin', 'coach')
  );
