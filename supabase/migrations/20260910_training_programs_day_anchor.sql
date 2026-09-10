-- =====================================================================
-- Issue #393 — generated programs are anchored to the drop date, not
-- to Monday, so #385's chosen training days can still land on excluded
-- weekdays.
--
-- WRITTEN, NOT RUN. Review before applying.
--
-- WHAT THIS ADDS:
--   One column on training_programs: day_anchor text, NOT NULL,
--   DEFAULT 'sequential', CHECK IN ('sequential', 'weekday').
--
-- WHY IT'S NEEDED:
--   training_days.day_number is OVERLOADED — it means two different
--   things depending on who wrote the program, and Schedule.js has no
--   way to tell them apart:
--
--     'weekday'    — the three generators (scProgramEngine,
--                    throwingEngine, hittingEngine) emit
--                    (week-1)*7 + weekday + 1, where weekday 0 = MONDAY.
--                    day_number 1/3/5 MEANS Mon/Wed/Fri.
--     'sequential' — Coach Tools hand-built programs (CoachTools.js
--                    :1692, :1724, :1951) emit a plain 1..N meaning
--                    "first session, second session, third session".
--                    No weekday meaning whatsoever.
--
--   handleProgramDrop (Schedule.js) places every day at
--   drop_date + (day_number - 1), so WHATEVER DAY YOU DROP ON BECOMES
--   DAY 1. For a generated program that silently rotates the whole
--   week: measured with the real engines, a coach who deselects Tuesday
--   and drops on a Wednesday gets two sessions on a real Tuesday inside
--   the first fortnight — the exact weekday they excluded because the
--   team practises then.
--
--   This column is what lets the drop handler tell the two apart, so it
--   can snap generated programs to the Monday of the dropped week and
--   leave hand-built ones exactly as they are.
--
-- WHY THE DEFAULT IS 'sequential' AND THERE IS NO BACKFILL:
--   'sequential' is the behaviour every existing row already has — it
--   is literally today's arithmetic. Defaulting that way means this
--   migration changes NOTHING on its own: every program in the table
--   keeps dropping precisely where it drops today, whether it came from
--   a generator or from Coach Tools.
--
--   Backfilling historical generated programs to 'weekday' was
--   considered and deliberately rejected. There is no reliable way to
--   tell from the stored rows which engine wrote them (no generator
--   stamp exists on the table), so any backfill would be a guess — and
--   a wrong guess scatters a hand-built program across a week or drops
--   its day 1 in the past. Programs generated from here on get the flag
--   at creation time, which is the only place the answer is known for
--   certain.
--
-- WHAT THIS DOES NOT CHANGE:
--   - training_days is untouched. day_number keeps both meanings; this
--     column records WHICH ONE, it does not rewrite any day numbers.
--   - Programs already materialised onto the calendar are
--     schedule_events rows and are never recomputed. Nothing on anyone's
--     calendar moves as a result of this migration or the app change
--     that reads it.
--   - No RLS change. training_programs' existing policies are
--     table/row-level, and a new column needs no policy of its own
--     (same reasoning as 20260810_facility_events_non_team_activity).
--
-- ⚠️  WHAT THE APP CHANGE ALONGSIDE THIS DOES CHANGE:
--   Where FUTURE drops of 'weekday' programs land. A generated program
--   dropped on a Wednesday will from then on start on that week's
--   Monday instead of that Wednesday. That is the fix — but it is a
--   real behaviour change, and #393 asks for it to be tested on a
--   throwaway athlete rather than shipped blind.
--
-- SAFE TO RUN TWICE. Every statement is guarded.
-- =====================================================================

ALTER TABLE public.training_programs
  ADD COLUMN IF NOT EXISTS day_anchor text NOT NULL DEFAULT 'sequential';

-- Guarded separately from the ADD COLUMN so a re-run doesn't fail on an
-- already-present constraint.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.training_programs'::regclass
      AND conname = 'training_programs_day_anchor_check'
  ) THEN
    ALTER TABLE public.training_programs
      ADD CONSTRAINT training_programs_day_anchor_check
      CHECK (day_anchor IN ('sequential', 'weekday'));
  END IF;
END $$;

COMMENT ON COLUMN public.training_programs.day_anchor IS
  'Issue #393: how to read training_days.day_number for this program. ''weekday'' = 1-based absolute calendar offset where day 1 IS MONDAY (written by scProgramEngine / throwingEngine / hittingEngine); Schedule.js snaps these to the Monday of the dropped week. ''sequential'' = a plain 1..N running order with no weekday meaning (Coach Tools hand-built); dropped as-is at drop_date + day_number - 1. Default ''sequential'' = the pre-#393 behaviour for every existing row.';


-- =====================================================================
-- CHECK IT WORKED.
--   1st query: expect one row — day_anchor, text, NO, 'sequential'.
--   2nd query: expect every existing program at 'sequential' and zero
--     at 'weekday'. Anything else means something backfilled this
--     column, which this migration deliberately does not do.
-- =====================================================================
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'training_programs'
  AND column_name = 'day_anchor';

SELECT day_anchor, count(*) AS programs
FROM public.training_programs
GROUP BY day_anchor
ORDER BY day_anchor;

-- =====================================================================
-- HOW TO UNDO — returns training_programs to exactly how it was before.
-- The app change must be reverted with it, or generated programs go
-- back to landing on the drop date while claiming Mon/Wed/Fri.
--
--   alter table public.training_programs
--     drop constraint if exists training_programs_day_anchor_check;
--   alter table public.training_programs
--     drop column if exists day_anchor;
-- =====================================================================
