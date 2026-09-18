-- =====================================================================
-- Issue #415 — subscribe to your NBP schedule from Google / Apple /
-- Outlook calendars.
--
-- Parents asked to see Naturals practices and training sessions on the
-- family calendar. Rather than Google OAuth (needs a Google Cloud
-- project, consent screen and per-user token storage), each athlete
-- gets a private iCalendar (.ics) feed URL that any calendar app can
-- subscribe to. The `calendar-feed` edge function renders it.
--
-- WHAT THIS ADDS:
--   calendar_feed_tokens — one row per user, holding the unguessable
--   token that IS the authentication for the feed URL. The URL is opened
--   by Google's servers / the phone's calendar app with no Supabase
--   session, so the edge function runs with verify_jwt = false and
--   looks the token up with the service role.
--
-- ROTATION: "Reset link" in the app deletes + reinserts the row, which
--   mints a fresh token and dead-ends every calendar still using the old
--   URL. That is the only revocation mechanism, by design.
--
-- RLS: an athlete can read/insert/update/delete only their own row. Staff
--   have no cross-user access — a feed URL is as sensitive as a session.
--
-- SAFE TO RUN TWICE.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.calendar_feed_tokens (
  user_id    uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  token      uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Supabase does NOT auto-grant (CLAUDE.md). service_role needs it too:
-- the edge function reads this table with the service key.
GRANT ALL ON public.calendar_feed_tokens TO authenticated;
GRANT ALL ON public.calendar_feed_tokens TO service_role;

ALTER TABLE public.calendar_feed_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_feed_tokens_select_own ON public.calendar_feed_tokens;
CREATE POLICY calendar_feed_tokens_select_own ON public.calendar_feed_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS calendar_feed_tokens_insert_own ON public.calendar_feed_tokens;
CREATE POLICY calendar_feed_tokens_insert_own ON public.calendar_feed_tokens
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS calendar_feed_tokens_update_own ON public.calendar_feed_tokens;
CREATE POLICY calendar_feed_tokens_update_own ON public.calendar_feed_tokens
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS calendar_feed_tokens_delete_own ON public.calendar_feed_tokens;
CREATE POLICY calendar_feed_tokens_delete_own ON public.calendar_feed_tokens
  FOR DELETE TO authenticated USING (user_id = auth.uid());

COMMENT ON TABLE public.calendar_feed_tokens IS
  '#415: per-user secret for the iCalendar subscription URL served by the calendar-feed edge function. Delete the row to revoke.';
