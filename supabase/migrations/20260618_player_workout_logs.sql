-- Mobile V1: players log actual sets/reps/load against assigned workouts.
-- Coach's prescribed values in training_exercises remain immutable; this table
-- stores per-set actuals so we can compute compliance and progress later.

CREATE TABLE IF NOT EXISTS public.player_workout_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  training_exercise_id UUID NOT NULL REFERENCES public.training_exercises(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  set_number INTEGER NOT NULL CHECK (set_number > 0),
  reps_actual INTEGER,
  load_actual TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE (player_id, training_exercise_id, log_date, set_number)
);

CREATE INDEX IF NOT EXISTS idx_player_workout_logs_player_date
  ON public.player_workout_logs(player_id, log_date DESC);

CREATE INDEX IF NOT EXISTS idx_player_workout_logs_exercise
  ON public.player_workout_logs(training_exercise_id);

ALTER TABLE public.player_workout_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "player_workout_logs_select" ON public.player_workout_logs;
CREATE POLICY "player_workout_logs_select" ON public.player_workout_logs
  FOR SELECT TO authenticated
  USING (
    player_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  );

DROP POLICY IF EXISTS "player_workout_logs_insert" ON public.player_workout_logs;
CREATE POLICY "player_workout_logs_insert" ON public.player_workout_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    player_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  );

DROP POLICY IF EXISTS "player_workout_logs_update" ON public.player_workout_logs;
CREATE POLICY "player_workout_logs_update" ON public.player_workout_logs
  FOR UPDATE TO authenticated
  USING (
    player_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  )
  WITH CHECK (
    player_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  );

DROP POLICY IF EXISTS "player_workout_logs_delete" ON public.player_workout_logs;
CREATE POLICY "player_workout_logs_delete" ON public.player_workout_logs
  FOR DELETE TO authenticated
  USING (
    player_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  );

GRANT ALL ON public.player_workout_logs TO authenticated;
