-- Issues #311 / #300 — Athlete Outreach send log.
--
-- UNAPPLIED. Nothing in src/AthleteOutreach.js requires this table: the screen
-- sends fine without it and degrades to "Send history is not being recorded —
-- apply supabase/migrations/20260815_outreach_log.sql first." Applying it turns
-- on two things: a "last reminded <date>" stamp next to each athlete, and a
-- permanent record of exactly what text went out to whom.
--
-- Scope, deliberately minimal: one row per athlete per send. No scheduling
-- columns, no "due" state, no queue — this feature has no automatic sending and
-- adding those columns would imply otherwise.

CREATE TABLE IF NOT EXISTS public.athlete_outreach_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'no_package' | 'low_or_expiring' | 'open_cage' (the three lists on screen).
  -- Kept as free text, not an enum: adding a fourth list should not need a
  -- migration.
  kind              text NOT NULL,
  user_id           uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sent_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sent_at           timestamptz NOT NULL DEFAULT now(),
  -- The exact rendered message this athlete received, so the record is of what
  -- was actually said, not of a template that may have been edited since.
  message_snapshot  text
);

CREATE INDEX IF NOT EXISTS athlete_outreach_log_user_idx
  ON public.athlete_outreach_log (user_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS athlete_outreach_log_kind_idx
  ON public.athlete_outreach_log (kind, sent_at DESC);

-- Staff-only, both ways. An athlete has no reason to read the outreach ledger
-- (it names every other athlete who was reminded), so this is NOT self-readable
-- — unlike store_session_usage.
ALTER TABLE public.athlete_outreach_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "athlete_outreach_log_select" ON public.athlete_outreach_log;
CREATE POLICY "athlete_outreach_log_select" ON public.athlete_outreach_log
  FOR SELECT
  USING (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "athlete_outreach_log_insert" ON public.athlete_outreach_log;
CREATE POLICY "athlete_outreach_log_insert" ON public.athlete_outreach_log
  FOR INSERT
  WITH CHECK (public.get_user_role() IN ('admin', 'coach'));

DROP POLICY IF EXISTS "athlete_outreach_log_delete" ON public.athlete_outreach_log;
CREATE POLICY "athlete_outreach_log_delete" ON public.athlete_outreach_log
  FOR DELETE
  USING (public.get_user_role() = 'admin');

GRANT SELECT, INSERT, DELETE ON public.athlete_outreach_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.athlete_outreach_log TO service_role;
