-- Issue #233: attendance tracking on training-slot reservations + player-side
-- cancellation. Coaches mark whether a booked player showed up; players can
-- cancel their own reservation up to 12h before the session (enforced in the
-- app — the RLS already lets a player update their own reservation row).

ALTER TABLE public.slot_reservations
  ADD COLUMN IF NOT EXISTS attendance text
    CHECK (attendance IS NULL OR attendance IN ('present', 'no_show', 'late', 'cancelled')),
  ADD COLUMN IF NOT EXISTS attendance_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_marked_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

-- Let admins (not just the player + slot's coach) update reservations so they
-- can mark attendance / cancel on anyone's behalf.
DROP POLICY IF EXISTS "Players and coaches can update reservations" ON public.slot_reservations;
CREATE POLICY "Players and coaches can update reservations" ON public.slot_reservations
  FOR UPDATE
  USING (
    player_id = auth.uid()
    OR public.get_user_role() = 'admin'
    OR EXISTS (SELECT 1 FROM public.training_slots ts WHERE ts.id = slot_reservations.slot_id AND ts.coach_id = auth.uid())
  )
  WITH CHECK (
    player_id = auth.uid()
    OR public.get_user_role() = 'admin'
    OR EXISTS (SELECT 1 FROM public.training_slots ts WHERE ts.id = slot_reservations.slot_id AND ts.coach_id = auth.uid())
  );
