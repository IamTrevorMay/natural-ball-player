-- =====================================================================
-- Issues #414 + #418 — Notes section: hitting/pitching can't save, and
-- the category set is restructured around "Mechanics".
--
-- #414 ROOT CAUSE (confirmed on the live DB 2026-09-18):
--   player_notes_category_check allowed only general / practice / game /
--   skill_session / disciplinary. The UI has offered 'hitting' and
--   'pitching' since the pitch-by-pitch log shipped, so every such save
--   failed the CHECK. No hitting/pitching row has ever been stored.
--
-- #418 (Cordell): drop Skill Session (same thing as Practice), and
--   replace the Hitting / Pitching buttons with one "Mechanics" category
--   that has an AREA drop-down — Base Running, Hitting, Pitching /
--   Throwing, Catching, Fielding — each carrying a deficiency checklist
--   so coaches can diagnose and prescribe drills.
--
-- WHAT THIS ADDS:
--   - category CHECK widened to include 'mechanics'. The three retired
--     values (skill_session, hitting, pitching) stay ALLOWED so a browser
--     still running the previous build during the deploy window cannot
--     hit #414 again; the new UI never writes them.
--   - area text — the Mechanics area, NULL for every other category.
--   - deficiencies jsonb — array of strings chosen from the per-area
--     list (src/mechanicsDeficiencies.js) plus free-text additions.
--
-- DATA MOVES:
--   - skill_session -> practice (Cordell: "it's already the same as
--     practice").
--   - hitting -> mechanics/hitting, pitching -> mechanics/pitching_throwing.
--     Zero rows exist today (they never could save) — guarded anyway.
--
-- SAFE TO RUN TWICE. Every statement is guarded or idempotent.
-- =====================================================================

ALTER TABLE public.player_notes
  ADD COLUMN IF NOT EXISTS area text,
  ADD COLUMN IF NOT EXISTS deficiencies jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.player_notes DROP CONSTRAINT IF EXISTS player_notes_category_check;
ALTER TABLE public.player_notes
  ADD CONSTRAINT player_notes_category_check
  CHECK (category = ANY (ARRAY[
    'general', 'practice', 'game', 'disciplinary', 'mechanics',
    -- retired, kept allowed for the deploy window only:
    'skill_session', 'hitting', 'pitching'
  ]));

ALTER TABLE public.player_notes DROP CONSTRAINT IF EXISTS player_notes_area_check;
ALTER TABLE public.player_notes
  ADD CONSTRAINT player_notes_area_check
  CHECK (area IS NULL OR area = ANY (ARRAY[
    'base_running', 'hitting', 'pitching_throwing', 'catching', 'fielding'
  ]));

UPDATE public.player_notes SET category = 'practice' WHERE category = 'skill_session';
UPDATE public.player_notes SET category = 'mechanics', area = 'hitting' WHERE category = 'hitting';
UPDATE public.player_notes SET category = 'mechanics', area = 'pitching_throwing' WHERE category = 'pitching';

COMMENT ON COLUMN public.player_notes.area IS
  '#418: Mechanics area (base_running / hitting / pitching_throwing / catching / fielding). NULL unless category = mechanics.';
COMMENT ON COLUMN public.player_notes.deficiencies IS
  '#418: jsonb array of deficiency strings the coach flagged for this Mechanics note. Vocabulary lives in src/mechanicsDeficiencies.js; free-text entries are allowed.';

-- CHECK IT WORKED: expect no skill_session/hitting/pitching rows left.
SELECT category, area, count(*) FROM public.player_notes GROUP BY 1, 2 ORDER BY 1, 2;
