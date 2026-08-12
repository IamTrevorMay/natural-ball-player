-- =====================================================================
-- Issue #310 — multiple players on a facility event
--
-- WRITTEN, NOT RUN. Review before applying.
--
-- WHAT THIS ADDS:
--   One array column on facility_events: athlete_ids uuid[].
--   Not null, default '{}' — mirrors the team_ids / coach_ids pattern
--   already on this table (see CLAUDE.md), not a new shape.
--
-- WHY IT'S NEEDED:
--   athlete_id (singular) can only ever hold ONE player, and it's only
--   ever set at event creation — there's no way back into it once the
--   event exists. Cordell asked for staff to be able to add a player to
--   an EXISTING event, for every event on the calendar (#310), which
--   needs a set staff can edit after the fact, not a single value fixed
--   at creation.
--
-- WHAT THIS DOES NOT CHANGE:
--   - athlete_id is kept, unchanged in meaning: it becomes the
--     PRIMARY/legacy athlete, the same role coach_id already plays next
--     to coach_ids on this same table. Any existing code that only reads
--     athlete_id keeps working exactly as it does today. The app code
--     that ships alongside this migration also keeps athlete_id in sync
--     with athlete_ids[0] on every save, same as coach_id already
--     tracks coach_ids[0] — see applyCoachAssignment in Schedule.js.
--   - No RLS change — same reasoning as the #308 migration on this
--     table (20260810_facility_events_non_team_activity.sql): RLS is
--     table/row-level, not column-level, so a new column needs no new
--     policy of its own.
--   - The backfill below only SETS athlete_ids from an existing
--     athlete_id; it never clears or overwrites athlete_id itself.
--
-- WHAT THIS DOES NOT SOLVE:
--   Paid/public bookings (public_bookings) are a separate guest table
--   with no link to real user accounts — this column does not touch
--   that table and does not give staff a way to add a public/guest
--   attendee to athlete_ids. See the #310 report for why that's a
--   separate, larger problem than this migration.
-- =====================================================================

alter table public.facility_events
  add column if not exists athlete_ids uuid[] not null default '{}';

-- Backfill: every event that already has a single athlete_id gets it as
-- the sole entry in athlete_ids, so the new multi-player UI shows
-- existing assignments instead of appearing empty. Same backfill
-- team_ids got from team_id when THAT column was introduced (see
-- CLAUDE.md's schedule_events.team_ids note for the precedent).
update public.facility_events
set athlete_ids = array[athlete_id]
where athlete_id is not null
  and athlete_ids = '{}';


-- ---------------------------------------------------------------------
-- CHECK IT WORKED.
--   1. Expect: athlete_ids listed as ARRAY / NO (not nullable) /
--      '{}'::uuid[] (default).
--   2. Expect: 0 rows — every event with an athlete_id should now also
--      have it inside athlete_ids.
-- ---------------------------------------------------------------------
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'facility_events' and column_name = 'athlete_ids';

select id, athlete_id, athlete_ids
from public.facility_events
where athlete_id is not null
  and not (athlete_ids @> array[athlete_id]);


-- =====================================================================
-- HOW TO UNDO — returns facility_events to exactly how it was before.
-- =====================================================================
--   alter table public.facility_events drop column if exists athlete_ids;
