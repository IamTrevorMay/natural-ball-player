-- =====================================================================
-- Issue #443 — WHOOP nudges on the web app.
--
-- Cordell wants the portal to tell an athlete, off their WHOOP data: that a
-- lift did not reach zone 4/5 or ran past 75 min; that they spent 10+ min
-- in zone 5; that they worked themselves up (zone 4/5) in the hours before
-- a game; that they slept too little or woke too often; and how much to
-- eat after a high-strain day. (Steps are not exposed by the WHOOP API, so
-- the "top 10% of steps" nudge cannot be built.)
--
-- 1. whoop_workouts gains the heart-rate zone split and the real start/end
--    timestamps. The rules need both; until now only avg/max HR and a
--    date were kept outside the encrypted raw_data blob.
-- 2. whoop_nudges — one row per athlete per rule per source record
--    (workout / sleep / cycle id). The `whoop` edge function evaluates the
--    rules after every sync (athlete-triggered or the 2-hourly cron in
--    api/whoop-sync.js) and upserts with ignoreDuplicates, so a rule fires
--    once per record no matter how many syncs see it. The bell reads the
--    athlete's undismissed rows; dismissing is an own-row UPDATE.
--
-- SAFE TO RUN TWICE.
-- =====================================================================

ALTER TABLE public.whoop_workouts ADD COLUMN IF NOT EXISTS start_at timestamptz;
ALTER TABLE public.whoop_workouts ADD COLUMN IF NOT EXISTS end_at timestamptz;
ALTER TABLE public.whoop_workouts ADD COLUMN IF NOT EXISTS zone_zero_ms bigint;
ALTER TABLE public.whoop_workouts ADD COLUMN IF NOT EXISTS zone_one_ms bigint;
ALTER TABLE public.whoop_workouts ADD COLUMN IF NOT EXISTS zone_two_ms bigint;
ALTER TABLE public.whoop_workouts ADD COLUMN IF NOT EXISTS zone_three_ms bigint;
ALTER TABLE public.whoop_workouts ADD COLUMN IF NOT EXISTS zone_four_ms bigint;
ALTER TABLE public.whoop_workouts ADD COLUMN IF NOT EXISTS zone_five_ms bigint;
ALTER TABLE public.whoop_workouts ADD COLUMN IF NOT EXISTS kilojoule numeric(10,2);

-- The cron needs "last synced" per athlete to stay incremental and to report.
ALTER TABLE public.whoop_tokens ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;
ALTER TABLE public.whoop_tokens ADD COLUMN IF NOT EXISTS last_sync_error text;

CREATE TABLE IF NOT EXISTS public.whoop_nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind text NOT NULL,          -- lift_low_strain | lift_too_long | zone5_long | pregame_strain | sleep_short | sleep_disrupted | fuel_surplus | low_strain
  source_key text NOT NULL,    -- the WHOOP workout / sleep / cycle id the rule fired on
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning')),
  title text NOT NULL,
  body text NOT NULL,
  occurred_on date,            -- the day the underlying record belongs to
  created_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  CONSTRAINT whoop_nudges_once_per_record UNIQUE (athlete_id, kind, source_key)
);

CREATE INDEX IF NOT EXISTS idx_whoop_nudges_athlete_open
  ON public.whoop_nudges (athlete_id, created_at DESC)
  WHERE dismissed_at IS NULL;

ALTER TABLE public.whoop_nudges ENABLE ROW LEVEL SECURITY;

-- The athlete reads their own; staff may read anyone's (same as the other
-- whoop_* tables). Only the service role writes — the rules run server side.
DROP POLICY IF EXISTS whoop_nudges_select ON public.whoop_nudges;
CREATE POLICY whoop_nudges_select ON public.whoop_nudges
  FOR SELECT TO authenticated
  USING (athlete_id = (SELECT auth.uid()) OR public.get_user_role() IN ('admin', 'coach'));

-- Dismissing is the one thing the athlete writes. Own rows only.
DROP POLICY IF EXISTS whoop_nudges_update_own ON public.whoop_nudges;
CREATE POLICY whoop_nudges_update_own ON public.whoop_nudges
  FOR UPDATE TO authenticated
  USING (athlete_id = (SELECT auth.uid()))
  WITH CHECK (athlete_id = (SELECT auth.uid()));

GRANT SELECT, UPDATE ON public.whoop_nudges TO authenticated;
GRANT ALL ON public.whoop_nudges TO service_role;

COMMENT ON TABLE public.whoop_nudges IS
  '#443: rule-generated WHOOP coaching nudges, one per athlete per rule per WHOOP record. Written by the whoop edge function after each sync; the bell shows undismissed rows.';
