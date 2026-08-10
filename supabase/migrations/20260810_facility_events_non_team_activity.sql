-- =====================================================================
-- Issue #308 (facility-event team tagging) — "Non team activity" flag
--
-- WHAT THIS ADDS:
--   One boolean column on facility_events: is_non_team_activity.
--   Default false, not null.
--
-- WHY IT'S NEEDED:
--   27 of 110 facility events currently have a team assigned (team_ids
--   is a non-empty array). The other 83 have an EMPTY team_ids — but an
--   empty team_ids means two different things that look identical today:
--     1. Nobody has gotten around to tagging this event yet.
--     2. This event genuinely has no team — general facility time, a
--        rental, open cage, etc. — and it never will.
--   Cordell wants the 83 flagged for manual review, and a way to mark
--   the deliberate ones so they stop showing up as needing review. This
--   column IS that mark. Once set, the bulk-tagging tool (#308) treats
--   the event as resolved and drops it from the "needs review" list,
--   even though team_ids is still empty.
--
-- WHAT THIS DOES NOT CHANGE:
--   - team_ids itself is untouched — this is a SEPARATE flag, not a
--     replacement for an empty array. An event can have
--     is_non_team_activity = true AND an empty team_ids at the same
--     time; that combination is the whole point.
--   - No RLS change. facility_events' existing policies already cover
--     reads/writes for this new column the same way they cover every
--     other column on the table (RLS is table-level and row-level, not
--     column-level, so a new column needs no new policy).
--   - No data is modified. Every existing row gets is_non_team_activity
--     = false via the column default — i.e. every row starts out as
--     "still needs review", which is correct: nothing has been reviewed
--     yet.
-- =====================================================================

alter table public.facility_events
  add column if not exists is_non_team_activity boolean not null default false;


-- ---------------------------------------------------------------------
-- CHECK IT WORKED.
--   Expect: is_non_team_activity listed as boolean / NO (not nullable) /
--   false (default).
-- ---------------------------------------------------------------------
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_name = 'facility_events' and column_name = 'is_non_team_activity';


-- =====================================================================
-- HOW TO UNDO — returns facility_events to exactly how it was before.
-- =====================================================================
--   alter table public.facility_events drop column if exists is_non_team_activity;
