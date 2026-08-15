-- =====================================================================
-- Issue #277 — "Practice / Game / Lifting RSVP addition"
--
-- WHAT THIS CREATES (in plain English):
--   One new table, public.event_rsvps. It holds one row per
--   (event occurrence, player) answer: "going", "not_going" or "maybe",
--   plus an optional note and the time they answered.
--
--   Nothing else. It creates no columns on existing tables, deletes
--   nothing, updates nothing, and backfills nothing. Every existing
--   row in every existing table is exactly the same after running
--   this as it was before. If you drop the table again (see the UNDO
--   block at the bottom) the database is byte-for-byte back to where
--   it started.
--
-- WHY A SEPARATE TABLE, AND WHY (event_id, event_date):
--   Team practices and games live in public.schedule_events. Team
--   lifting sessions and other team-tagged facility bookings live in
--   public.facility_events (rows whose team_ids array names the team).
--   Both kinds can repeat, and the app renders each repeat as its own
--   occurrence — so "Tuesday's practice" and "next Tuesday's practice"
--   can be the SAME database row seen on two dates. An RSVP therefore
--   has to be pinned to a date as well as an event, which is why the
--   uniqueness rule is (event_id, event_date, user_id) and not just
--   (event_id, user_id).
--
--   event_source records which of the two tables event_id points at.
--   Because the id can come from either table there is deliberately NO
--   foreign key on event_id — deleting an event leaves its RSVP rows
--   behind as harmless orphans. user_id DOES have a foreign key, so
--   deleting a user removes their RSVPs.
--
-- WHO CAN SEE WHAT (row level security):
--   * A player can read, create and change their OWN answer.
--   * A player can also READ everyone's answers for an event belonging
--     to a team they are on — that is the headcount the owner asked
--     for. They cannot read answers for other teams' events.
--   * Staff (role 'admin' or 'coach' — interns are set up as coaches)
--     can read and write every row.
--
-- DEFAULT BEHAVIOUR:
--   "No response" is the ABSENCE of a row. There is no 'no_response'
--   value and no row is created for anyone up front, so a player who
--   has not answered simply has no row and the coach's roster panel
--   counts them as a non-responder.
--
-- SAFE TO RUN TWICE. Every statement is guarded.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.event_rsvps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The event this answer belongs to. NO foreign key on purpose: the id
  -- can point at either schedule_events or facility_events (see
  -- event_source). For a repeating event this is the id of the MASTER /
  -- series row, matching what the calendar UI calls _master_id.
  event_id      uuid NOT NULL,
  event_source  text NOT NULL DEFAULT 'schedule_events'
                CHECK (event_source IN ('schedule_events', 'facility_events')),
  -- The single occurrence being answered for. For a repeating event this
  -- is the date that occurrence lands on, NOT the series start date.
  event_date    date NOT NULL,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  response      text NOT NULL CHECK (response IN ('going', 'not_going', 'maybe')),
  responded_at  timestamptz NOT NULL DEFAULT now(),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- One answer per person per occurrence. Named constraint (not a bare
-- unique index) because the app upserts with
-- on_conflict=event_id,event_date,user_id.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.event_rsvps'::regclass
      AND conname = 'event_rsvps_occurrence_user_key'
  ) THEN
    ALTER TABLE public.event_rsvps
      ADD CONSTRAINT event_rsvps_occurrence_user_key
      UNIQUE (event_id, event_date, user_id);
  END IF;
END $$;

-- Headcount lookups: "everyone's answers for this occurrence".
CREATE INDEX IF NOT EXISTS event_rsvps_occurrence_idx
  ON public.event_rsvps (event_id, event_date);
-- "My RSVPs" list: one player's upcoming answers, newest date first.
CREATE INDEX IF NOT EXISTS event_rsvps_user_idx
  ON public.event_rsvps (user_id, event_date DESC);

-- ---------------------------------------------------------------------
-- updated_at bookkeeping (mirrors the other *_set_updated_at triggers).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_rsvps_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS event_rsvps_set_updated_at ON public.event_rsvps;
CREATE TRIGGER event_rsvps_set_updated_at
  BEFORE UPDATE ON public.event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.event_rsvps_set_updated_at();

-- ---------------------------------------------------------------------
-- Which teams does an event belong to?
--
-- Used by the SELECT policy below so a player can see the headcount for
-- their own team's events. SECURITY DEFINER for the same reason
-- public.get_user_role() is: a policy that queried schedule_events /
-- facility_events directly would re-enter THOSE tables' row level
-- security and could silently return nothing.
--
-- facility_events note: a modified/cancelled occurrence is stored as a
-- child row whose own team_ids is often empty, so fall back to the
-- parent series' team_ids.
-- schedule_events note: team_ids is the current multi-team column;
-- team_id is the legacy scalar that some older rows still only have.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_rsvp_team_ids(p_event_id uuid, p_event_source text)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE p_event_source
    WHEN 'facility_events' THEN (
      SELECT COALESCE(
               NULLIF(fe.team_ids, '{}'::uuid[]),
               NULLIF(parent.team_ids, '{}'::uuid[]),
               '{}'::uuid[])
      FROM public.facility_events fe
      LEFT JOIN public.facility_events parent ON parent.id = fe.recurrence_parent_id
      WHERE fe.id = p_event_id
    )
    ELSE (
      SELECT COALESCE(
               NULLIF(se.team_ids, '{}'::uuid[]),
               CASE WHEN se.team_id IS NULL THEN '{}'::uuid[] ELSE ARRAY[se.team_id] END)
      FROM public.schedule_events se
      WHERE se.id = p_event_id
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.event_rsvp_team_ids(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.event_rsvp_team_ids(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- Row level security.
-- ---------------------------------------------------------------------
ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;

-- Read: own row, OR staff, OR anyone on a team the event belongs to
-- (this is what makes the headcount visible to the whole team).
DROP POLICY IF EXISTS "event_rsvps_select" ON public.event_rsvps;
CREATE POLICY "event_rsvps_select" ON public.event_rsvps
  FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
    OR EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.user_id = (SELECT auth.uid())
        AND tm.team_id = ANY (public.event_rsvp_team_ids(event_rsvps.event_id, event_rsvps.event_source))
    )
  );

-- Write: a player answers only for themselves. Staff can answer/fix on
-- anyone's behalf.
DROP POLICY IF EXISTS "event_rsvps_insert" ON public.event_rsvps;
CREATE POLICY "event_rsvps_insert" ON public.event_rsvps
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  );

DROP POLICY IF EXISTS "event_rsvps_update" ON public.event_rsvps;
CREATE POLICY "event_rsvps_update" ON public.event_rsvps
  FOR UPDATE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  );

DROP POLICY IF EXISTS "event_rsvps_delete" ON public.event_rsvps;
CREATE POLICY "event_rsvps_delete" ON public.event_rsvps
  FOR DELETE TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.get_user_role() IN ('admin', 'coach')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_rsvps TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_rsvps TO service_role;

COMMENT ON TABLE public.event_rsvps IS
  'Issue #277: per-occurrence RSVP (going / not_going / maybe) for team practices, games and lifting sessions. Keyed by (event_id, event_date, user_id); event_source says whether event_id is a schedule_events or facility_events row. "No response" = no row.';


-- =====================================================================
-- CHECK IT WORKED.
--   1st query: expect the ten columns listed above.
--   2nd query: expect four policies (select / insert / update / delete).
--   3rd query: expect 0 — nobody has RSVPd yet.
-- =====================================================================
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'event_rsvps'
ORDER BY ordinal_position;

SELECT policyname, cmd FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'event_rsvps'
ORDER BY policyname;

SELECT count(*) AS rsvp_rows FROM public.event_rsvps;


-- =====================================================================
-- HOW TO UNDO — returns the database to exactly how it was before.
-- =====================================================================
--   DROP TABLE IF EXISTS public.event_rsvps;
--   DROP FUNCTION IF EXISTS public.event_rsvps_set_updated_at();
--   DROP FUNCTION IF EXISTS public.event_rsvp_team_ids(uuid, text);
