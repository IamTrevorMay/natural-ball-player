-- Issue #191 backfill: populate schedule_events.category for legacy workouts.
-- 87k+ workout events were created before the category column existed. The
-- calendar still color-codes them by guessing from title, which is what #191
-- was about. This migration resolves a category for each event so the new
-- explicit-column rendering kicks in.
--
-- Strategy:
--   Pass 1 — join se.title to workout_templates.name and read the template's
--            folder. This catches every event dragged from the program library.
--   Pass 2 — title regex (mirrors the JS getWorkoutCategory heuristic) for
--            events whose title doesn't match a template (custom workouts).
--   Pass 3 — anything still null → 'general'.

-- Index for the title→template join (also useful for future backfills).
CREATE INDEX IF NOT EXISTS idx_schedule_events_title
  ON public.schedule_events (title)
  WHERE event_type = 'workout' AND category IS NULL;

-- Pass 1: template-folder match
UPDATE public.schedule_events se
SET category = CASE
  WHEN lower(wt.folder) IN ('body builder','college','high school','pro','youth','youth weighted','strength') THEN 'strength'
  WHEN lower(wt.folder) = 'cardio'    THEN 'conditioning'
  WHEN lower(wt.folder) = 'hitting'   THEN 'hitting'
  WHEN lower(wt.folder) = 'pitching'  THEN 'pitching'
  WHEN lower(wt.folder) = 'submarine' THEN 'pitching'
  WHEN lower(wt.folder) IN ('catching','infield','outfield','football') THEN 'fielding'
  WHEN lower(wt.folder) IN ('recovery','rehab','meals') THEN 'recovery'
  WHEN lower(wt.folder) = 'warmup'    THEN 'warmup'
  ELSE NULL
END
FROM public.workout_templates wt
WHERE se.event_type = 'workout'
  AND se.category IS NULL
  AND se.title = wt.name;

-- Pass 2: title-regex fallback for events without a matching template.
-- Order matters — strength catches DE/M#W# patterns before they fall to general.
UPDATE public.schedule_events
SET category = CASE
  WHEN lower(coalesce(title,'')) ~ 'pitch|throw|mound|bullpen|long toss|velo'                        THEN 'pitching'
  WHEN lower(coalesce(title,'')) ~ 'hit|tee|batting|swing|^bp\s|\sbp\s|\sbp$'                        THEN 'hitting'
  WHEN lower(coalesce(title,'')) ~ 'catch|frame|block|pop time|throwdown'                            THEN 'fielding'
  WHEN lower(coalesce(title,'')) ~ 'warm|mobil|stretch|\bcars\b|foam|band|yoga|cool'                 THEN 'warmup'
  WHEN lower(coalesce(title,'')) ~ 'recovery|rehab'                                                  THEN 'recovery'
  WHEN lower(coalesce(title,'')) ~ 'cardio|conditioning|sprint|run\b|aerobic|tempo'                  THEN 'conditioning'
  WHEN lower(coalesce(title,'')) ~ 'lower|upper|squat|bench|deadlift|\bde\b|m\d+\s*w\d+|press|clean' THEN 'strength'
  ELSE NULL
END
WHERE event_type = 'workout' AND category IS NULL;

-- Pass 3: catch-all so legacy rows render in a defined color (gray) rather
-- than falling through to the JS title heuristic.
UPDATE public.schedule_events
SET category = 'general'
WHERE event_type = 'workout' AND category IS NULL;

-- Drop the helper index — the column is now backfilled; future inserts set
-- category up front so this index would never get used again.
DROP INDEX IF EXISTS idx_schedule_events_title;
