-- WHOOP queries always filter on (athlete_id, *_date) — add composite indexes
-- so heavy users don't sequential-scan thousands of rows on every load.

CREATE INDEX IF NOT EXISTS whoop_cycles_athlete_date_idx
  ON public.whoop_cycles (athlete_id, cycle_date DESC);
CREATE INDEX IF NOT EXISTS whoop_sleep_athlete_date_idx
  ON public.whoop_sleep (athlete_id, sleep_date DESC);
CREATE INDEX IF NOT EXISTS whoop_workouts_athlete_date_idx
  ON public.whoop_workouts (athlete_id, workout_date DESC);
