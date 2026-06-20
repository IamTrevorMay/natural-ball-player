-- Audit IH3: client code (useNotifications.js + WorkAdminHours/TimeOff/Home/
-- Schedule/MyHours/TimeOff/WorkMessages + Messages.js) subscribes to live
-- changes on these tables via supabase.channel(...).on('postgres_changes', ...).
-- The supabase_realtime publication did NOT include them, so every subscribe
-- call silently no-ops and notification-bell / live timesheet flows fall back
-- to manual refresh.
--
-- Realtime respects RLS — clients only receive rows they can SELECT — so
-- enabling these tables doesn't widen visibility beyond what's already
-- permitted by the existing policies.

DO $$
BEGIN
  -- Main portal
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messages';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reads'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.slot_reservations'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Work Portal
DO $$ BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_hour_entries'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_time_off_requests'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_schedule_events'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_schedule_assignments'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.staff_announcements'; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
