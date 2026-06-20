-- 2-week usage experiment (#V2-research).
-- Anonymous + role-tagged events to map which features actually get used.
-- No user_id, no PII. session_id is a random UUID per browser session.
--
-- Retention: delete rows older than 14 days. Wire to pg_cron or run a one-off
-- migration after the experiment ends.

CREATE TABLE IF NOT EXISTS public.usage_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  session_id UUID NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('player', 'coach', 'admin')),
  secondary_role TEXT CHECK (secondary_role IN ('player', 'coach', 'admin')),
  portal TEXT NOT NULL CHECK (portal IN ('main', 'work')),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'view_enter', 'view_exit', 'modal_open', 'modal_close',
    'action_click', 'error'
  )),
  event_name TEXT NOT NULL,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  meta JSONB
);

CREATE INDEX IF NOT EXISTS idx_usage_events_occurred
  ON public.usage_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_events_role_type
  ON public.usage_events(role, event_type);
CREATE INDEX IF NOT EXISTS idx_usage_events_name
  ON public.usage_events(event_name);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usage_events_insert ON public.usage_events;
CREATE POLICY usage_events_insert ON public.usage_events
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS usage_events_admin_select ON public.usage_events;
CREATE POLICY usage_events_admin_select ON public.usage_events
  FOR SELECT TO authenticated
  USING (public.get_user_role() = 'admin');

GRANT INSERT, SELECT ON public.usage_events TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.usage_events_id_seq TO authenticated;
