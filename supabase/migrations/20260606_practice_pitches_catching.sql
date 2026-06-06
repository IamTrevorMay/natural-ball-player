-- Issue #192: extend Practice Stats so coaches can log pitching and catching
-- reps too, not just hitting at-bats.

CREATE TABLE IF NOT EXISTS public.practice_pitches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  context TEXT NOT NULL DEFAULT 'bullpen' CHECK (context IN ('bullpen', 'lives', 'scrimmage', 'practice', 'cage', 'long_toss', 'other')),
  pitch_type TEXT,
  velocity NUMERIC,
  spin_rate NUMERIC,
  location TEXT,
  result TEXT CHECK (result IN ('strike', 'ball', 'foul', 'in_play', 'swing_miss', 'k', 'bb', 'hbp', 'hit', 'out')),
  pitch_count INTEGER,
  notes TEXT,
  logged_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_practice_pitches_player_date
  ON public.practice_pitches(player_id, log_date DESC);

ALTER TABLE public.practice_pitches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "practice_pitches_select" ON public.practice_pitches;
CREATE POLICY "practice_pitches_select" ON public.practice_pitches
  FOR SELECT TO authenticated
  USING (
    player_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  );

DROP POLICY IF EXISTS "practice_pitches_insert" ON public.practice_pitches;
CREATE POLICY "practice_pitches_insert" ON public.practice_pitches
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "practice_pitches_update" ON public.practice_pitches;
CREATE POLICY "practice_pitches_update" ON public.practice_pitches
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'))
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "practice_pitches_delete" ON public.practice_pitches;
CREATE POLICY "practice_pitches_delete" ON public.practice_pitches
  FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));

GRANT ALL ON public.practice_pitches TO authenticated;


CREATE TABLE IF NOT EXISTS public.practice_catching (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  context TEXT NOT NULL DEFAULT 'practice' CHECK (context IN ('practice', 'lives', 'scrimmage', 'bullpen', 'cage', 'other')),
  drill_type TEXT NOT NULL CHECK (drill_type IN ('pop_time', 'framing', 'blocking', 'throwdown', 'receiving', 'other')),
  pop_time_sec NUMERIC,
  throwdown_accuracy TEXT,
  block_attempts INTEGER,
  block_clean INTEGER,
  framing_grade TEXT CHECK (framing_grade IN ('A', 'B', 'C', 'D', 'F')),
  notes TEXT,
  logged_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_practice_catching_player_date
  ON public.practice_catching(player_id, log_date DESC);

ALTER TABLE public.practice_catching ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "practice_catching_select" ON public.practice_catching;
CREATE POLICY "practice_catching_select" ON public.practice_catching
  FOR SELECT TO authenticated
  USING (
    player_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  );

DROP POLICY IF EXISTS "practice_catching_insert" ON public.practice_catching;
CREATE POLICY "practice_catching_insert" ON public.practice_catching
  FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "practice_catching_update" ON public.practice_catching;
CREATE POLICY "practice_catching_update" ON public.practice_catching
  FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'))
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "practice_catching_delete" ON public.practice_catching;
CREATE POLICY "practice_catching_delete" ON public.practice_catching
  FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));

GRANT ALL ON public.practice_catching TO authenticated;
