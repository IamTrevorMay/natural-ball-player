-- Issue #186: Practice Stats tab. Tracks live at-bats during training/pre-season
-- so coaches can log results outside of game settings. Surfaced as a new tab in
-- Profile next to Communication.

CREATE TABLE IF NOT EXISTS public.practice_at_bats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  ab_date DATE NOT NULL,
  context TEXT NOT NULL DEFAULT 'practice' CHECK (context IN ('practice', 'lives', 'scrimmage', 'fall_ball', 'cage', 'other')),
  pitcher_name TEXT,
  pitch_type TEXT,
  pitch_count INTEGER,
  result TEXT NOT NULL DEFAULT 'unknown' CHECK (result IN ('1B', '2B', '3B', 'HR', 'BB', 'HBP', 'K', 'GO', 'FO', 'LO', 'PO', 'FC', 'SAC', 'unknown')),
  exit_velocity NUMERIC,
  launch_angle NUMERIC,
  distance NUMERIC,
  notes TEXT,
  logged_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_practice_at_bats_player_date
  ON public.practice_at_bats(player_id, ab_date DESC);

ALTER TABLE public.practice_at_bats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "practice_at_bats_select" ON public.practice_at_bats;
CREATE POLICY "practice_at_bats_select" ON public.practice_at_bats
  FOR SELECT TO authenticated
  USING (
    player_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  );

DROP POLICY IF EXISTS "practice_at_bats_insert" ON public.practice_at_bats;
CREATE POLICY "practice_at_bats_insert" ON public.practice_at_bats
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "practice_at_bats_update" ON public.practice_at_bats;
CREATE POLICY "practice_at_bats_update" ON public.practice_at_bats
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'))
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "practice_at_bats_delete" ON public.practice_at_bats;
CREATE POLICY "practice_at_bats_delete" ON public.practice_at_bats
  FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));

GRANT ALL ON public.practice_at_bats TO authenticated;
