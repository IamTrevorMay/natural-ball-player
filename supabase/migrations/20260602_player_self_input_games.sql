-- Issue #169: allow players to add their own external games to schedule_events.
-- Limited strictly to event_type='game' rows owned by the player; everything
-- else (workouts, meals, practices, team events) stays admin/coach-only.

DROP POLICY IF EXISTS "Players can insert own games" ON public.schedule_events;
CREATE POLICY "Players can insert own games" ON public.schedule_events
  FOR INSERT
  WITH CHECK (
    player_id = auth.uid()
    AND event_type = 'game'
    AND public.get_user_role() = 'player'
  );

DROP POLICY IF EXISTS "Players can update own games" ON public.schedule_events;
CREATE POLICY "Players can update own games" ON public.schedule_events
  FOR UPDATE
  USING (
    player_id = auth.uid()
    AND event_type = 'game'
    AND public.get_user_role() = 'player'
  )
  WITH CHECK (
    player_id = auth.uid()
    AND event_type = 'game'
    AND public.get_user_role() = 'player'
  );

DROP POLICY IF EXISTS "Players can delete own games" ON public.schedule_events;
CREATE POLICY "Players can delete own games" ON public.schedule_events
  FOR DELETE
  USING (
    player_id = auth.uid()
    AND event_type = 'game'
    AND public.get_user_role() = 'player'
  );
