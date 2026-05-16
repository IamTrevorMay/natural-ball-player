-- WHOOP Integration Tables
-- Tokens (service-role only — no RLS policies means deny-all for anon/authenticated)
CREATE TABLE IF NOT EXISTS whoop_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  whoop_user_id TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE whoop_tokens ENABLE ROW LEVEL SECURITY;
-- No policies = deny all for authenticated/anon. Only service_role can access.

-- Cycles (one per day per user)
CREATE TABLE IF NOT EXISTS whoop_cycles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  whoop_cycle_id TEXT NOT NULL,
  cycle_date DATE NOT NULL,
  recovery_score NUMERIC(5,2),
  recovery_state TEXT,
  hrv_rmssd NUMERIC(10,2),
  resting_heart_rate NUMERIC(5,1),
  strain_score NUMERIC(5,2),
  kilojoule NUMERIC(10,2),
  spo2_pct NUMERIC(5,2),
  skin_temp_celsius NUMERIC(5,2),
  raw_data TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(athlete_id, whoop_cycle_id)
);

ALTER TABLE whoop_cycles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON whoop_cycles TO authenticated;

CREATE POLICY whoop_cycles_select ON whoop_cycles FOR SELECT TO authenticated
  USING (athlete_id = auth.uid() OR public.get_user_role() IN ('admin', 'coach'));

CREATE POLICY whoop_cycles_insert ON whoop_cycles FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

CREATE POLICY whoop_cycles_update ON whoop_cycles FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));

CREATE POLICY whoop_cycles_delete ON whoop_cycles FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));

-- Sleep
CREATE TABLE IF NOT EXISTS whoop_sleep (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  whoop_sleep_id TEXT NOT NULL,
  sleep_date DATE NOT NULL,
  sleep_score NUMERIC(5,2),
  total_duration_ms BIGINT,
  rem_duration_ms BIGINT,
  sws_duration_ms BIGINT,
  light_duration_ms BIGINT,
  awake_duration_ms BIGINT,
  sleep_efficiency NUMERIC(5,2),
  sleep_consistency NUMERIC(5,2),
  respiratory_rate NUMERIC(5,2),
  raw_data TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(athlete_id, whoop_sleep_id)
);

ALTER TABLE whoop_sleep ENABLE ROW LEVEL SECURITY;
GRANT ALL ON whoop_sleep TO authenticated;

CREATE POLICY whoop_sleep_select ON whoop_sleep FOR SELECT TO authenticated
  USING (athlete_id = auth.uid() OR public.get_user_role() IN ('admin', 'coach'));

CREATE POLICY whoop_sleep_insert ON whoop_sleep FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

CREATE POLICY whoop_sleep_update ON whoop_sleep FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));

CREATE POLICY whoop_sleep_delete ON whoop_sleep FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));

-- Workouts
CREATE TABLE IF NOT EXISTS whoop_workouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  whoop_workout_id TEXT NOT NULL,
  workout_date DATE NOT NULL,
  sport_name TEXT,
  sport_id INTEGER,
  strain_score NUMERIC(5,2),
  average_heart_rate NUMERIC(5,1),
  max_heart_rate NUMERIC(5,1),
  distance_meter NUMERIC(10,2),
  duration_ms BIGINT,
  raw_data TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(athlete_id, whoop_workout_id)
);

ALTER TABLE whoop_workouts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON whoop_workouts TO authenticated;

CREATE POLICY whoop_workouts_select ON whoop_workouts FOR SELECT TO authenticated
  USING (athlete_id = auth.uid() OR public.get_user_role() IN ('admin', 'coach'));

CREATE POLICY whoop_workouts_insert ON whoop_workouts FOR INSERT TO authenticated
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

CREATE POLICY whoop_workouts_update ON whoop_workouts FOR UPDATE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));

CREATE POLICY whoop_workouts_delete ON whoop_workouts FOR DELETE TO authenticated
  USING (public.get_user_role() IN ('admin', 'coach'));

-- Add whoop columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS whoop_connected BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS whoop_oauth_state TEXT;
