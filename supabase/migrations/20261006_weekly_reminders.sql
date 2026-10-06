-- #438: weekly stats / PT check-in reminders for NBP+ athletes.
--
-- Cordell: every NBP+ / college / pro player gets a reminder each week to
-- update their game stats (profile → Stats) and flag any PT news — injured,
-- working back, or feeling something. Delivered BOTH as an email (Vercel
-- cron → api/weekly-reminders.js → the `weekly-reminders` edge function,
-- Monday mornings facility time) AND as a bell item in the app that the
-- athlete dismisses.
--
-- One row per (athlete, week, kind). The row is the whole story: the cron
-- inserts it (status 'pending'), the send flips it to sent / skipped /
-- failed, and the athlete's bell reads it back — so the email and the bell
-- can never disagree about whether this week's reminder exists. Re-running
-- the cron in the same week only picks up rows still 'pending', so a retry
-- after a partial failure can't double-send.

CREATE TABLE IF NOT EXISTS public.weekly_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,                      -- Monday, facility time
  kind TEXT NOT NULL DEFAULT 'stats_pt',
  email TEXT,                                    -- address the email went to (null = none on file)
  email_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (email_status IN ('pending', 'sent', 'skipped', 'failed', 'no_email')),
  email_error TEXT,
  resend_id TEXT,
  sent_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ,                      -- athlete cleared the bell item
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, week_start, kind)
);

CREATE INDEX IF NOT EXISTS idx_weekly_reminders_user_week ON public.weekly_reminders(user_id, week_start);
CREATE INDEX IF NOT EXISTS idx_weekly_reminders_pending ON public.weekly_reminders(week_start) WHERE email_status = 'pending';

ALTER TABLE public.weekly_reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS weekly_reminders_select ON public.weekly_reminders;
CREATE POLICY weekly_reminders_select ON public.weekly_reminders
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()) OR public.get_user_role() IN ('admin', 'coach'));

-- The athlete may only dismiss their own; everything else is written by the
-- service role from the edge function.
DROP POLICY IF EXISTS weekly_reminders_update_own ON public.weekly_reminders;
CREATE POLICY weekly_reminders_update_own ON public.weekly_reminders
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

GRANT SELECT, UPDATE ON public.weekly_reminders TO authenticated;
GRANT ALL ON public.weekly_reminders TO service_role;

-- Who gets the reminder: every athlete in a training group (teams.team_type
-- = 'training', the NBP+ rule from #436 — the College and Pro groups are
-- training groups too) who is a player (role or secondary_role), has an
-- email, and isn't Archived / Inactive in Manage Athletes. Service-role only:
-- it returns addresses.
CREATE OR REPLACE FUNCTION public.weekly_reminder_audience()
RETURNS TABLE (user_id uuid, email text, full_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT ON (u.id) u.id, lower(trim(u.email)), u.full_name
  FROM public.team_members tm
  JOIN public.teams t ON t.id = tm.team_id AND t.team_type = 'training'
  JOIN public.users u ON u.id = tm.user_id
  LEFT JOIN public.player_profiles pp ON pp.user_id = u.id
  WHERE (u.role = 'player' OR u.secondary_role = 'player')
    AND u.email IS NOT NULL AND trim(u.email) <> ''
    AND COALESCE(pp.status, 'Active') NOT IN ('Archived', 'Inactive')
  ORDER BY u.id;
$$;
REVOKE ALL ON FUNCTION public.weekly_reminder_audience() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_reminder_audience() TO service_role;
