-- =====================================================================
-- Issue #306 — weekly allowances need to know what KIND of session a slot
-- is.
--
-- Cordell's package answers (2026-08-25) are all of the form "4 strength &
-- conditioning sessions a week plus 1 skills session a week". Two separate
-- allowances, so the app has to be able to tell an S&C session from a
-- skills session. It used to infer that from the coach: a session whose
-- coach carries the "Strength & Conditioning" skill tag counted as
-- lifting. On 2026-09-23, 13 of 18 coaches carry that tag, so the
-- inference no longer tells the two apart.
--
-- This column lets the coach say which it is when they create the slot.
--
--   session_type  'sc'      — strength & conditioning / lifting
--                 'skills'  — hitting, pitching, fielding, catching,
--                             base running, throwing
--                 NULL      — not stated; the app falls back to the old
--                             coach-tag inference, so nothing changes for
--                             existing slots until someone sets it.
--
-- Loose text, no CHECK — same convention as slot_reservations.cancel_reason
-- and booking_package_flags.reason. Exception children (#279 tombstones,
-- #292 moves) copy it from their master like the other rendered fields.
-- =====================================================================

ALTER TABLE public.training_slots
  ADD COLUMN IF NOT EXISTS session_type text;

-- ---------------------------------------------------------------------
-- CHECK IT WORKED.
-- ---------------------------------------------------------------------
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'training_slots' AND column_name = 'session_type';

-- =====================================================================
-- HOW TO UNDO
-- =====================================================================
--   ALTER TABLE public.training_slots DROP COLUMN IF EXISTS session_type;
