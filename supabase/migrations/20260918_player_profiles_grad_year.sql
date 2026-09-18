-- =====================================================================
-- Issue #416 — recruiting board by class year.
--
-- Cordell wants a staff-only list that auto-populates every athlete who
-- has not signed yet, grouped 9th → 12th grade and College Freshman →
-- Senior, with a grad-year drop-down (2015–2040).
--
-- WHY A NEW COLUMN:
--   player_profiles.grade is free text — 130+ distinct spellings on the
--   live DB ("11th Grade ", "Junior HS", "Sophmore", "10", "RS Freshman",
--   "Vanderbilt "). A grade label also goes stale every August. A
--   graduation year never changes, and the app derives the current class
--   from it (src/gradYear.js), so the board rolls over on its own.
--
-- BACKFILL:
--   Derived from the grade text for the 2026–27 school year (12th grade
--   = class of 2027). Numeric grades are trusted as written; the word
--   forms (freshman/sophomore/junior/senior) are read as HIGH SCHOOL
--   unless the text says college or player_profiles.level = 'College'.
--   "RS" = redshirt (one year behind the nominal class). Anything
--   ambiguous ("HS", "College", "Pro", "18u", school names) stays NULL and
--   staff set it in Manage Athletes. Measured before writing: ~576 of
--   1,006 profiles map; 430 stay NULL.
--
--   The backfill only fills NULLs, so re-running never overwrites a
--   value staff have since corrected.
--
-- SAFE TO RUN TWICE.
-- =====================================================================

ALTER TABLE public.player_profiles
  ADD COLUMN IF NOT EXISTS grad_year integer;

ALTER TABLE public.player_profiles DROP CONSTRAINT IF EXISTS player_profiles_grad_year_check;
ALTER TABLE public.player_profiles
  ADD CONSTRAINT player_profiles_grad_year_check
  CHECK (grad_year IS NULL OR (grad_year BETWEEN 2000 AND 2060));

COMMENT ON COLUMN public.player_profiles.grad_year IS
  '#416: high-school graduation year. The class label (9th…12th, College Fr…Sr) is derived from it in src/gradYear.js; never store the label.';

WITH g AS (
  SELECT id, lower(trim(coalesce(grade, ''))) AS g, level
  FROM public.player_profiles
  WHERE grad_year IS NULL
), m AS (
  SELECT id,
    CASE
      -- explicit numeric grades win regardless of level
      WHEN g ~ '(^|\s)12th' OR g = '12' THEN 2027
      WHEN g ~ '(^|\s)11th' OR g = '11' THEN 2028
      WHEN g ~ '(^|\s)10th' OR g = '10' THEN 2029
      WHEN g ~ '(^|\s)9th'  OR g = '9'  THEN 2030
      WHEN g ~ '(^|\s)8th'  OR g = '8'  THEN 2031
      WHEN g ~ '(^|\s)7th'  OR g = '7'  THEN 2032
      WHEN g ~ '(^|\s)6th'  OR g = '6'  THEN 2033
      WHEN g ~ '(^|\s)5th' AND g !~ 'year' THEN 2034
      WHEN g ~ '(^|\s)4th'  OR g = '4'  THEN 2035
      WHEN g ~ '(^|\s)3rd'  OR g = '3'  THEN 2036
      WHEN g ~ '(^|\s)2nd'  OR g = '2'  THEN 2037
      WHEN g ~ '(^|\s)1st'  OR g = '1'  THEN 2038
      WHEN g ~ 'kindergarten' THEN 2039
      -- college-only phrasings
      WHEN g ~ '5th year' THEN 2022
      WHEN g ~ 'rs (sophomore|sophmore)' THEN 2024
      WHEN g ~ 'rs freshman' THEN 2025
      -- word forms: college if the text or the level says so, else high school
      WHEN g ~ 'senior'              AND (g ~ 'college' OR level = 'College') THEN 2023
      WHEN g ~ 'junior'              AND (g ~ 'college' OR level = 'College') THEN 2024
      WHEN g ~ '(sophomore|sophmore)' AND (g ~ 'college' OR level = 'College') THEN 2025
      WHEN g ~ 'freshman'            AND (g ~ 'college' OR level = 'College') THEN 2026
      WHEN g ~ 'senior'  THEN 2027
      WHEN g ~ 'junior'  THEN 2028
      WHEN g ~ '(sophomore|sophmore)' THEN 2029
      WHEN g ~ 'freshman' THEN 2030
      ELSE NULL
    END AS grad_year
  FROM g
)
UPDATE public.player_profiles pp
SET grad_year = m.grad_year
FROM m
WHERE m.id = pp.id AND m.grad_year IS NOT NULL AND pp.grad_year IS NULL;

-- CHECK IT WORKED: expect ~576 mapped, ~430 NULL.
SELECT grad_year, count(*) FROM public.player_profiles GROUP BY 1 ORDER BY 1 NULLS LAST;
