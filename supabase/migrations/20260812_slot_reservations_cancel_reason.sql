-- =====================================================================
-- Issue #306 — sick-cancel returns (the last piece of the package ledger)
--
-- WRITTEN, NOT RUN. Review before applying.
--
-- WHAT THIS ADDS:
--   Three nullable columns on slot_reservations:
--     cancel_reason     text        — 'sick' | 'other' (whatever the app writes)
--     cancel_reason_by  uuid        — who chose the reason (the cancelling player)
--     cancel_reason_at  timestamptz — when
--   No default, no backfill — every existing cancelled reservation simply
--   has no reason on file, which is accurate (nobody was ever asked before
--   this shipped).
--
-- WHY IT'S NEEDED:
--   Cordell: "The session should only go back into their package if it was
--   a sick cancel. If it's not a sick cancel the session will count
--   against the package." The app needs somewhere to record which one it
--   was, captured at the moment of cancellation.
--
-- WHAT THIS DOES NOT CHANGE:
--   - No CHECK constraint on cancel_reason. Deliberately loose (text, not
--     an enum) — the two current values are an app-level convention, not a
--     schema-level guarantee, matching how similar text fields elsewhere in
--     this schema (e.g. store_products.kind) are the exception, not the
--     rule, for adding a CHECK. Keeps this migration a pure additive change
--     with nothing else to get wrong.
--   - No RLS change. slot_reservations' existing UPDATE policy already
--     covers the player, the slot's coach, and admin — the app writes
--     these three columns in the SAME update() call that already sets
--     status/cancelled_at (see #313_slot_attendance's policy, unchanged
--     here), so no new policy is needed for a new column on an already-
--     writable row.
-- =====================================================================

ALTER TABLE public.slot_reservations
  ADD COLUMN IF NOT EXISTS cancel_reason text,
  ADD COLUMN IF NOT EXISTS cancel_reason_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason_at timestamptz;


-- ---------------------------------------------------------------------
-- CHECK IT WORKED.
--   Expect: three new columns listed, all nullable, no default.
-- ---------------------------------------------------------------------
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'slot_reservations'
  AND column_name IN ('cancel_reason', 'cancel_reason_by', 'cancel_reason_at');


-- =====================================================================
-- HOW TO UNDO — returns slot_reservations to exactly how it was before.
-- =====================================================================
--   ALTER TABLE public.slot_reservations
--     DROP COLUMN IF EXISTS cancel_reason,
--     DROP COLUMN IF EXISTS cancel_reason_by,
--     DROP COLUMN IF EXISTS cancel_reason_at;
