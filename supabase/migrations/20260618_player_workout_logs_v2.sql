-- Mobile V1 refactor: prod stores workouts as schedule_events (event_type='workout')
-- with exercises serialized into notes. Repoint player_workout_logs to that source.
-- training_exercises is unused in prod (0 rows), so the FK becomes optional.

ALTER TABLE public.player_workout_logs
  ADD COLUMN IF NOT EXISTS schedule_event_id UUID REFERENCES public.schedule_events(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS exercise_index INTEGER;

ALTER TABLE public.player_workout_logs
  ALTER COLUMN training_exercise_id DROP NOT NULL;

-- Drop the old unique constraint and add a new one keyed on the new columns.
-- Safe to drop unconditionally: the table is empty in prod.
ALTER TABLE public.player_workout_logs
  DROP CONSTRAINT IF EXISTS player_workout_logs_player_id_training_exercise_id_log_date_key;

ALTER TABLE public.player_workout_logs
  DROP CONSTRAINT IF EXISTS player_workout_logs_player_event_exercise_set_key;

ALTER TABLE public.player_workout_logs
  ADD CONSTRAINT player_workout_logs_player_event_exercise_set_key
  UNIQUE (player_id, schedule_event_id, exercise_index, set_number);

CREATE INDEX IF NOT EXISTS idx_player_workout_logs_event
  ON public.player_workout_logs(schedule_event_id);
