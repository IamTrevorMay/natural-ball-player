-- =====================================================================
-- Issue #408 — notify a coach when they're tagged on a facility event
--
-- WRITTEN, NOT RUN. Review before applying.
--
-- WHAT THIS ADDS:
--   One table: facility_event_notice_reads (event_id, user_id).
--   A row means "this coach has seen/dismissed the notice that they were
--   added to this event". The ABSENCE of a row is the notification.
--
-- WHY IT'S NEEDED:
--   coach_ids on facility_events already records who is assigned (see
--   CLAUDE.md), but nothing ever tells the coach. useNotifications.js
--   derives every notification from a table query, and there was no
--   facility-event source in useMainPortalCounts at all — so a coach
--   tagged on an event found out by noticing it on the calendar, or not
--   at all. That's #408 verbatim.
--
-- WHY A TABLE RATHER THAN created_at > last_sign_in:
--   The cheap version compares facility_events.created_at against the
--   user's last sign-in and needs no schema. It was rejected because it
--   clears the notice whether or not the coach ever saw it: a coach who
--   stays logged in on the facility iPad never gets one, and a coach who
--   logs in on their phone at a red light loses it for good. It also
--   only fires on INSERT, so being ADDED to an event that already
--   existed — the exact thing Cordell reported — produces nothing.
--   A dismissal row survives refreshes, devices and re-logins, and
--   clears only when the coach acts.
--
-- WHAT THIS DOES NOT CHANGE:
--   - facility_events is untouched. No new column, no RLS change there.
--   - Nothing writes this table except the coach dismissing their own
--     notice. It is not an audit trail and not a read receipt anyone
--     else can see.
--   - Assignment itself still happens through coach_ids exactly as it
--     does today (applyCoachAssignment in Schedule.js).
--
-- SCOPE — WHICH EVENTS PRODUCE A NOTICE:
--   The app pairs this with a query for events that are still live: a
--   one-off dated today or later, or a recurring series whose rule has
--   not run out (endType 'never', or until >= today). Past one-offs and
--   finished series never produce a notice.
--
-- THE DAY-ONE BACKLOG, AND WHY THIS MIGRATION BACKFILLS:
--   "Absence of a row is the notification" means that WITHOUT a backfill,
--   every assignment that already exists reads as brand new the moment
--   this ships. Measured against the live database before writing this:
--   279 (event, coach) pairs already exist, 109 of them Cordell's alone.
--   He would open the portal to 109 notifications about events he set up
--   himself, which is worse than the silence #408 is complaining about.
--   So the backfill below marks every CURRENT assignment as already
--   dismissed. Everyone starts at zero and only assignments made from
--   this point on ever notify. That is the whole point: #408 asks to be
--   told when someone TAGS you, not to be handed an inventory.
--
-- SAFE TO RUN TWICE. Every statement is guarded, and the backfill is
-- ON CONFLICT DO NOTHING — a second run adds nothing and, importantly,
-- does NOT re-dismiss a notice someone has since been given.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.facility_event_notice_reads (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The facility event whose assignment notice was dismissed. For a
  -- repeating event this is the MASTER/series row id — a coach is added
  -- to the series, not to one occurrence, so one dismissal covers the
  -- whole series rather than nagging once per week.
  event_id     uuid NOT NULL REFERENCES public.facility_events(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now()
);

-- One dismissal per person per event. Named constraint (not a bare
-- unique index) so the app can upsert with on_conflict=event_id,user_id
-- — a partial or unnamed index does NOT work with PostgREST upsert, the
-- same trap work_message_reads hit (see CLAUDE.md).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.facility_event_notice_reads'::regclass
      AND conname = 'facility_event_notice_reads_event_user_key'
  ) THEN
    ALTER TABLE public.facility_event_notice_reads
      ADD CONSTRAINT facility_event_notice_reads_event_user_key
      UNIQUE (event_id, user_id);
  END IF;
END $$;

-- The only lookup this table has: "which of these events have I already
-- dismissed?" — one coach, a handful of event ids.
CREATE INDEX IF NOT EXISTS facility_event_notice_reads_user_idx
  ON public.facility_event_notice_reads (user_id, event_id);

-- ---------------------------------------------------------------------
-- BACKFILL — everyone starts at zero. See "THE DAY-ONE BACKLOG" above.
--
-- Marks every assignment that exists RIGHT NOW as already dismissed, so
-- the bell only ever reports assignments made after this migration runs.
--
-- Only master/standalone rows (recurrence_parent_id IS NULL) are seeded,
-- because those are the only ids the app ever writes here — a coach is
-- added to a series, not to one occurrence.
--
-- The join to users is not decoration: coach_ids is a plain uuid[] with
-- no foreign key behind it, so it can still name a deleted account. The
-- FK on user_id would reject those rows and take the whole INSERT with
-- them.
-- ---------------------------------------------------------------------
INSERT INTO public.facility_event_notice_reads (event_id, user_id)
SELECT DISTINCT fe.id, c.uid
FROM public.facility_events fe
CROSS JOIN LATERAL unnest(fe.coach_ids) AS c(uid)
JOIN public.users u ON u.id = c.uid
WHERE fe.recurrence_parent_id IS NULL
  AND fe.coach_ids IS NOT NULL
ON CONFLICT (event_id, user_id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Row level security.
--
-- Strictly own-only, in every direction. Unlike event_rsvps there is no
-- staff-read-all policy and no staff-write-on-behalf policy: nobody has
-- any business reading whether a colleague has dismissed a notification,
-- and nothing legitimate needs to dismiss one for them.
-- ---------------------------------------------------------------------
ALTER TABLE public.facility_event_notice_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "facility_event_notice_reads_select" ON public.facility_event_notice_reads;
CREATE POLICY "facility_event_notice_reads_select" ON public.facility_event_notice_reads
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "facility_event_notice_reads_insert" ON public.facility_event_notice_reads;
CREATE POLICY "facility_event_notice_reads_insert" ON public.facility_event_notice_reads
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

-- DELETE exists so a dismissal can be undone (and so a coach's own rows
-- go with them). There is deliberately no UPDATE policy — a dismissal is
-- a fact with nothing to amend.
--
-- That constrains how the app writes: it must upsert with
-- ignoreDuplicates: true (ON CONFLICT DO NOTHING), which needs only
-- INSERT. A plain .upsert() defaults to ON CONFLICT DO UPDATE and WOULD
-- need an UPDATE policy — it fails silently-ish here. Dismissing twice
-- keeps the first dismissed_at, which is the more accurate timestamp
-- anyway.
DROP POLICY IF EXISTS "facility_event_notice_reads_delete" ON public.facility_event_notice_reads;
CREATE POLICY "facility_event_notice_reads_delete" ON public.facility_event_notice_reads
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Supabase does NOT auto-grant; missing grants read as "permission
-- denied" even with correct policies (CLAUDE.md). service_role is
-- granted for the same reason the users table is — an edge function
-- connects as service_role, not authenticated.
GRANT SELECT, INSERT, DELETE ON public.facility_event_notice_reads TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.facility_event_notice_reads TO service_role;

COMMENT ON TABLE public.facility_event_notice_reads IS
  'Issue #408: a coach has seen/dismissed the bell notice that they were added to a facility event (coach_ids). Absence of a row IS the notification. Keyed by (event_id, user_id); event_id is the master/series row for a repeating event. Own-only in every direction.';


-- =====================================================================
-- CHECK IT WORKED.
--   1st query: expect four columns (id, event_id, user_id, dismissed_at).
--   2nd query: expect three policies (select / insert / delete).
--   3rd query: expect ~279 — the backfill, NOT real dismissals. If this
--     comes back 0 the backfill did not run and every coach is about to
--     be handed their whole event list as unread; stop and investigate
--     before deploying the app change that reads this table.
-- =====================================================================
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'facility_event_notice_reads'
ORDER BY ordinal_position;

SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'facility_event_notice_reads'
ORDER BY policyname;

SELECT count(*) AS seeded_dismissals FROM public.facility_event_notice_reads;

-- =====================================================================
-- HOW TO UNDO — removes the table and everything that depends on it.
-- Nothing else references it, so this is a clean drop.
--
--   drop table if exists public.facility_event_notice_reads;
-- =====================================================================
