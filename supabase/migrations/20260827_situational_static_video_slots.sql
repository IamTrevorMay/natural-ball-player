-- #372: let the Situational guide's two static tabs — General (GEN) and Team
-- Plays (TEAM) — hold example videos, the same way the nine on-field position
-- tabs already do via situational_plays.video_url (#274, #240).
--
-- Those two tabs are hardcoded JSX, not database rows, so their sections have
-- no id to hang a video_url on. This adds a stable text key instead: a row
-- whose static_key is set is NOT a situation in the picker, it is the video
-- slot for one hardcoded section. The key never changes when the prose is
-- reworded, so re-editing the copy will not orphan a video.
--
-- Additive only: one nullable column plus one unique index. No existing row is
-- read, changed or deleted, no column is dropped, and no policy is altered —
-- staff already have insert/update rights on situational_plays from
-- 20260629_situational_plays.sql, and those same policies cover these rows.
ALTER TABLE public.situational_plays ADD COLUMN IF NOT EXISTS static_key text;

-- One row per static slot. Safe to add to a populated table: every existing
-- row has static_key NULL, and Postgres treats NULLs as distinct in a unique
-- index, so this cannot fail on existing data.
CREATE UNIQUE INDEX IF NOT EXISTS situational_plays_static_key_idx
  ON public.situational_plays (static_key);
